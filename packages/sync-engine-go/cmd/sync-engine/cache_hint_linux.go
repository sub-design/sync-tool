//go:build linux

package main

import (
	"os"
	"syscall"
)

const (
	posixFadvSequential = 2
	posixFadvDontNeed   = 4
)

func adviseInputFileStart(file *os.File) {
	fadvise(file, posixFadvSequential)
}

func adviseInputFileDone(file *os.File) {
	fadvise(file, posixFadvDontNeed)
}

func fadvise(file *os.File, advice uintptr) {
	_, _, _ = syscall.Syscall6(syscall.SYS_FADVISE64, file.Fd(), 0, 0, advice, 0, 0)
}
