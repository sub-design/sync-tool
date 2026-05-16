package main

import (
	"bufio"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
)

const (
	engineVersion             = "delta-v1"
	defaultBlockSize          = 64 * 1024
	maxDataRun                = 1024 * 1024
	largeFileNoCacheThreshold = 50 * 1024 * 1024
)

type Signature struct {
	Version   string           `json:"version"`
	BlockSize int              `json:"blockSize"`
	FileSize  int64            `json:"fileSize"`
	SHA256    string           `json:"sha256"`
	Blocks    []BlockSignature `json:"blocks"`
}

type BlockSignature struct {
	Index  int    `json:"index"`
	Offset int64  `json:"offset"`
	Size   int    `json:"size"`
	Weak   uint32 `json:"weak"`
	Strong string `json:"strong"`
}

type DeltaOp struct {
	Type   string `json:"type"`
	Index  int    `json:"index,omitempty"`
	Offset int64  `json:"offset,omitempty"`
	Size   int    `json:"size,omitempty"`
	Data   string `json:"data,omitempty"`
}

func main() {
	if len(os.Args) < 2 {
		fail(errors.New("usage: sync-engine <signature|delta|apply> [flags]"))
	}

	var err error
	switch os.Args[1] {
	case "signature":
		err = runSignature(os.Args[2:])
	case "delta":
		err = runDelta(os.Args[2:])
	case "apply":
		err = runApply(os.Args[2:])
	default:
		err = fmt.Errorf("unknown command %q", os.Args[1])
	}
	if err != nil {
		fail(err)
	}
}

func fail(err error) {
	fmt.Fprintln(os.Stderr, err.Error())
	os.Exit(1)
}

func runSignature(args []string) error {
	fs := flag.NewFlagSet("signature", flag.ContinueOnError)
	filePath := fs.String("file", "", "file to sign")
	outPath := fs.String("out", "", "signature output path")
	blockSize := fs.Int("block-size", defaultBlockSize, "block size in bytes")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *filePath == "" || *outPath == "" {
		return errors.New("signature requires -file and -out")
	}
	if *blockSize <= 0 {
		return errors.New("-block-size must be positive")
	}

	sig, err := BuildSignature(*filePath, *blockSize)
	if err != nil {
		return err
	}
	return writeJSONFile(*outPath, sig)
}

func runDelta(args []string) error {
	fs := flag.NewFlagSet("delta", flag.ContinueOnError)
	sourcePath := fs.String("source", "", "source file")
	signaturePath := fs.String("signature", "", "signature JSON path")
	outPath := fs.String("out", "", "delta JSONL output path")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *sourcePath == "" || *signaturePath == "" || *outPath == "" {
		return errors.New("delta requires -source, -signature, and -out")
	}

	var sig Signature
	if err := readJSONFile(*signaturePath, &sig); err != nil {
		return err
	}
	return BuildDelta(*sourcePath, sig, *outPath)
}

func runApply(args []string) error {
	fs := flag.NewFlagSet("apply", flag.ContinueOnError)
	basisPath := fs.String("basis", "", "basis file")
	deltaPath := fs.String("delta", "", "delta JSONL path")
	outPath := fs.String("out", "", "output file path")
	expectSHA256 := fs.String("expect-sha256", "", "expected SHA-256 hex of output")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *basisPath == "" || *deltaPath == "" || *outPath == "" {
		return errors.New("apply requires -basis, -delta, and -out")
	}
	return ApplyDelta(*basisPath, *deltaPath, *outPath, *expectSHA256)
}

func BuildSignature(filePath string, blockSize int) (Signature, error) {
	file, err := openInputFile(filePath)
	if err != nil {
		return Signature{}, err
	}
	defer closeInputFile(file)

	stat, err := file.Stat()
	if err != nil {
		return Signature{}, err
	}

	sig := Signature{
		Version:   engineVersion,
		BlockSize: blockSize,
		FileSize:  stat.Size(),
		Blocks:    make([]BlockSignature, 0, int((stat.Size()+int64(blockSize)-1)/int64(blockSize))),
	}

	buf := make([]byte, blockSize)
	fileHash := sha256.New()
	var offset int64
	for index := 0; ; index++ {
		n, readErr := io.ReadFull(file, buf)
		if readErr == io.EOF {
			break
		}
		if readErr == io.ErrUnexpectedEOF {
			readErr = nil
		}
		if readErr != nil {
			return Signature{}, readErr
		}

		block := buf[:n]
		if _, err := fileHash.Write(block); err != nil {
			return Signature{}, err
		}
		sig.Blocks = append(sig.Blocks, BlockSignature{
			Index:  index,
			Offset: offset,
			Size:   n,
			Weak:   RollingChecksum(block),
			Strong: strongHash(block),
		})
		offset += int64(n)
		if n < blockSize {
			break
		}
	}
	sig.SHA256 = hex.EncodeToString(fileHash.Sum(nil))

	return sig, nil
}

func BuildDelta(sourcePath string, sig Signature, outPath string) error {
	if sig.Version != engineVersion {
		return fmt.Errorf("unsupported signature version %q", sig.Version)
	}
	if sig.BlockSize <= 0 {
		return errors.New("signature blockSize must be positive")
	}

	sourceFile, err := openInputFile(sourcePath)
	if err != nil {
		return err
	}
	defer closeInputFile(sourceFile)
	source := bufio.NewReaderSize(sourceFile, sig.BlockSize*2)

	out, err := createFile(outPath)
	if err != nil {
		return err
	}
	defer out.Close()
	writer := bufio.NewWriter(out)
	defer writer.Flush()
	encoder := json.NewEncoder(writer)

	weakMap := make(map[uint32][]BlockSignature, len(sig.Blocks))
	for _, block := range sig.Blocks {
		weakMap[block.Weak] = append(weakMap[block.Weak], block)
	}

	pending := make([]byte, 0, maxDataRun)
	window := make([]byte, sig.BlockSize)
	n, readErr := io.ReadFull(source, window)
	if readErr == io.EOF {
		return nil
	}
	if readErr == io.ErrUnexpectedEOF {
		readErr = nil
	}
	if readErr != nil {
		return readErr
	}
	weak := RollingChecksum(window[:n])

	for {
		chunk := window[:n]
		match, ok := matchBlock(chunk, weak, weakMap)
		if ok {
			if err := flushData(encoder, &pending); err != nil {
				return err
			}
			if err := encoder.Encode(DeltaOp{Type: "copy", Index: match.Index, Offset: match.Offset, Size: match.Size}); err != nil {
				return err
			}
			n, readErr = io.ReadFull(source, window)
			if readErr == io.EOF {
				break
			}
			if readErr == io.ErrUnexpectedEOF {
				readErr = nil
			}
			if readErr != nil {
				return readErr
			}
			if n == 0 {
				break
			}
			weak = RollingChecksum(window[:n])
			continue
		}

		if n < sig.BlockSize {
			pending = append(pending, chunk...)
			break
		}

		oldest := chunk[0]
		pending = append(pending, oldest)
		next, err := source.ReadByte()
		if err == io.EOF {
			pending = append(pending, chunk[1:]...)
			break
		}
		if err != nil {
			return err
		}
		copy(window, window[1:])
		window[sig.BlockSize-1] = next
		weak = RollChecksum(weak, oldest, next, sig.BlockSize)

		if len(pending) >= maxDataRun {
			if err := flushData(encoder, &pending); err != nil {
				return err
			}
		}
	}

	return flushData(encoder, &pending)
}

func ApplyDelta(basisPath string, deltaPath string, outPath string, expectSHA256 string) error {
	basis, err := openInputFile(basisPath)
	if err != nil {
		return err
	}
	defer closeInputFile(basis)

	delta, err := os.Open(deltaPath)
	if err != nil {
		return err
	}
	defer delta.Close()

	tmpPath := outPath + ".tmp"
	out, err := createFile(tmpPath)
	if err != nil {
		return err
	}

	decoder := json.NewDecoder(bufio.NewReader(delta))
	for {
		var op DeltaOp
		if err := decoder.Decode(&op); err != nil {
			if err == io.EOF {
				break
			}
			out.Close()
			_ = os.Remove(tmpPath)
			return err
		}

		switch op.Type {
		case "copy":
			if op.Size < 0 || op.Index < 0 {
				out.Close()
				_ = os.Remove(tmpPath)
				return errors.New("invalid copy operation")
			}
			if _, err := basis.Seek(op.Offset, io.SeekStart); err != nil {
				out.Close()
				_ = os.Remove(tmpPath)
				return err
			}
			if _, err := io.CopyN(out, basis, int64(op.Size)); err != nil {
				out.Close()
				_ = os.Remove(tmpPath)
				return err
			}
		case "data":
			data, err := base64.StdEncoding.DecodeString(op.Data)
			if err != nil {
				out.Close()
				_ = os.Remove(tmpPath)
				return err
			}
			if _, err := out.Write(data); err != nil {
				out.Close()
				_ = os.Remove(tmpPath)
				return err
			}
		default:
			out.Close()
			_ = os.Remove(tmpPath)
			return fmt.Errorf("unknown delta op %q", op.Type)
		}
	}

	if err := out.Close(); err != nil {
		_ = os.Remove(tmpPath)
		return err
	}
	if expectSHA256 != "" {
		actualSHA256, err := fileSHA256(tmpPath)
		if err != nil {
			_ = os.Remove(tmpPath)
			return err
		}
		if actualSHA256 != expectSHA256 {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("output SHA-256 mismatch: got %s, expected %s", actualSHA256, expectSHA256)
		}
	}
	return os.Rename(tmpPath, outPath)
}

func matchBlock(chunk []byte, weak uint32, weakMap map[uint32][]BlockSignature) (BlockSignature, bool) {
	candidates := weakMap[weak]
	if len(candidates) == 0 {
		return BlockSignature{}, false
	}
	strong := strongHash(chunk)
	for _, candidate := range candidates {
		if candidate.Size == len(chunk) && candidate.Strong == strong {
			return candidate, true
		}
	}
	return BlockSignature{}, false
}

func flushData(encoder *json.Encoder, pending *[]byte) error {
	if len(*pending) == 0 {
		return nil
	}
	err := encoder.Encode(DeltaOp{
		Type: "data",
		Data: base64.StdEncoding.EncodeToString(*pending),
	})
	*pending = (*pending)[:0]
	return err
}

func RollingChecksum(block []byte) uint32 {
	var a uint32
	var b uint32
	for i, value := range block {
		a += uint32(value)
		b += uint32(len(block)-i) * uint32(value)
	}
	return (b << 16) | (a & 0xffff)
}

func RollChecksum(weak uint32, oldByte byte, newByte byte, windowSize int) uint32 {
	a := weak & 0xffff
	b := weak >> 16
	a = (a - uint32(oldByte) + uint32(newByte)) & 0xffff
	b = (b - (uint32(windowSize) * uint32(oldByte)) + a) & 0xffff
	return (b << 16) | a
}

func strongHash(block []byte) string {
	sum := sha256.Sum256(block)
	return base64.StdEncoding.EncodeToString(sum[:16])
}

func fileSHA256(path string) (string, error) {
	file, err := openInputFile(path)
	if err != nil {
		return "", err
	}
	defer closeInputFile(file)

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeJSONFile(path string, value any) error {
	file, err := createFile(path)
	if err != nil {
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func readJSONFile(path string, value any) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	return json.NewDecoder(file).Decode(value)
}

func openInputFile(path string) (*os.File, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	if shouldAvoidCache(file) {
		adviseInputFileStart(file)
	}
	return file, nil
}

func closeInputFile(file *os.File) error {
	if shouldAvoidCache(file) {
		adviseInputFileDone(file)
	}
	return file.Close()
}

func shouldAvoidCache(file *os.File) bool {
	stat, err := file.Stat()
	return err == nil && stat.Size() >= largeFileNoCacheThreshold
}

func createFile(path string) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	return os.Create(path)
}
