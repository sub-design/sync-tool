package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSignatureDeltaApplyRoundTrip(t *testing.T) {
	basisData := bytes.Repeat([]byte("abcdefghijklmnop"), 128)
	sourceData := append([]byte{}, basisData...)
	copy(sourceData[512:528], []byte("CHANGED-CHANGED!!"))
	sourceData = append(sourceData[:257], append([]byte("inserted"), sourceData[257:]...)...)
	sourceData = append(sourceData, []byte("tail")...)

	roundTripDelta(t, basisData, sourceData, 128)
}

func TestSignatureDeltaApplyEdgeCases(t *testing.T) {
	blockSize := 16
	cases := []struct {
		name   string
		basis  []byte
		source []byte
	}{
		{
			name:   "empty basis and empty source",
			basis:  []byte{},
			source: []byte{},
		},
		{
			name:   "non-empty basis to empty source",
			basis:  []byte("remove all bytes"),
			source: []byte{},
		},
		{
			name:   "empty basis to tiny source",
			basis:  []byte{},
			source: []byte("tiny"),
		},
		{
			name:   "source smaller than block",
			basis:  []byte("abcdefghijk"),
			source: []byte("abcXYZhijk"),
		},
		{
			name:   "source exactly one block",
			basis:  []byte("abcdefghijklmnop"),
			source: []byte("abcdEFGHijklmnop"),
		},
		{
			name:   "insert at block boundary",
			basis:  []byte("abcdefghijklmnopQRSTUVWXYZ123456"),
			source: []byte("abcdefghijklmnopINSERTQRSTUVWXYZ123456"),
		},
		{
			name:   "delete at block boundary",
			basis:  []byte("abcdefghijklmnopDELETEQRSTUVWXYZ123456"),
			source: []byte("abcdefghijklmnopQRSTUVWXYZ123456"),
		},
		{
			name:   "repeated duplicate blocks",
			basis:  []byte("AAAABBBBAAAACCCCBBBBAAAA"),
			source: []byte("BBBBAAAACCCCAAAABBBBTAIL"),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			roundTripDelta(t, tc.basis, tc.source, blockSize)
		})
	}
}

func TestRollingChecksumMatchesRolledWindows(t *testing.T) {
	data := []byte("0123456789abcdefghijklmnopqrstuvwxyz")
	windowSize := 8
	weak := RollingChecksum(data[:windowSize])

	for offset := 1; offset <= len(data)-windowSize; offset++ {
		weak = RollChecksum(weak, data[offset-1], data[offset+windowSize-1], windowSize)
		expected := RollingChecksum(data[offset : offset+windowSize])
		if weak != expected {
			t.Fatalf("rolled checksum mismatch at offset %d: got %d, expected %d", offset, weak, expected)
		}
	}
}

func TestApplyRejectsCorruptDeltaWithoutReplacingOutput(t *testing.T) {
	dir := t.TempDir()
	basis := filepath.Join(dir, "basis.bin")
	deltaPath := filepath.Join(dir, "bad.delta.jsonl")
	out := filepath.Join(dir, "out.bin")

	if err := os.WriteFile(basis, []byte("basis"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deltaPath, []byte(`{"type":"data","data":"not-base64!"}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := ApplyDelta(basis, deltaPath, out, ""); err == nil {
		t.Fatal("expected corrupt delta to fail")
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "original" {
		t.Fatalf("output was replaced after corrupt delta: %q", string(got))
	}
}

func TestApplyRejectsHashMismatchWithoutReplacingOutput(t *testing.T) {
	dir := t.TempDir()
	basis := filepath.Join(dir, "basis.bin")
	source := filepath.Join(dir, "source.bin")
	deltaPath := filepath.Join(dir, "source.delta.jsonl")
	out := filepath.Join(dir, "out.bin")

	if err := os.WriteFile(basis, []byte("basis basis basis"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("source source source"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	sig, err := BuildSignature(basis, 4)
	if err != nil {
		t.Fatal(err)
	}
	if err := BuildDelta(source, sig, deltaPath); err != nil {
		t.Fatal(err)
	}

	if err := ApplyDelta(basis, deltaPath, out, "0000000000000000000000000000000000000000000000000000000000000000"); err == nil {
		t.Fatal("expected hash mismatch to fail")
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "original" {
		t.Fatalf("output was replaced after hash mismatch: %q", string(got))
	}
}

func TestApplyRejectsInvalidCopyWithoutReplacingOutput(t *testing.T) {
	dir := t.TempDir()
	basis := filepath.Join(dir, "basis.bin")
	deltaPath := filepath.Join(dir, "bad-copy.delta.jsonl")
	out := filepath.Join(dir, "out.bin")

	if err := os.WriteFile(basis, []byte("basis"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(out, []byte("original"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeDeltaOps(deltaPath, []DeltaOp{{Type: "copy", Offset: 100, Size: 10}}); err != nil {
		t.Fatal(err)
	}

	if err := ApplyDelta(basis, deltaPath, out, ""); err == nil {
		t.Fatal("expected invalid copy to fail")
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "original" {
		t.Fatalf("output was replaced after invalid copy: %q", string(got))
	}
}

func TestBuildDeltaRejectsInvalidSignature(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.bin")
	out := filepath.Join(dir, "source.delta.jsonl")
	if err := os.WriteFile(source, []byte("source"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := BuildDelta(source, Signature{Version: "unknown", BlockSize: 4}, out); err == nil {
		t.Fatal("expected unsupported signature version to fail")
	}
	if err := BuildDelta(source, Signature{Version: engineVersion, BlockSize: 0}, out); err == nil {
		t.Fatal("expected invalid block size to fail")
	}
}

func roundTripDelta(t *testing.T, basisData []byte, sourceData []byte, blockSize int) {
	t.Helper()
	dir := t.TempDir()
	basis := filepath.Join(dir, "basis.bin")
	source := filepath.Join(dir, "source.bin")
	sigPath := filepath.Join(dir, "basis.sig.json")
	deltaPath := filepath.Join(dir, "source.delta.jsonl")
	out := filepath.Join(dir, "out.bin")

	if err := os.WriteFile(basis, basisData, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, sourceData, 0o644); err != nil {
		t.Fatal(err)
	}

	sig, err := BuildSignature(basis, blockSize)
	if err != nil {
		t.Fatal(err)
	}
	if err := writeJSONFile(sigPath, sig); err != nil {
		t.Fatal(err)
	}
	if err := BuildDelta(source, sig, deltaPath); err != nil {
		t.Fatal(err)
	}
	sourceHash, err := fileSHA256(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := ApplyDelta(basis, deltaPath, out, sourceHash); err != nil {
		t.Fatal(err)
	}

	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, sourceData) {
		t.Fatalf("applied delta does not match source: got %d bytes, expected %d", len(got), len(sourceData))
	}
}

func writeDeltaOps(path string, ops []DeltaOp) error {
	file, err := createFile(path)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	for _, op := range ops {
		if err := encoder.Encode(op); err != nil {
			return err
		}
	}
	return nil
}
