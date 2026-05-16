//go:build darwin

package main

import (
	"os"
	"syscall"
)

const fNoCache = 48

func adviseInputFileStart(file *os.File) {
	_, _, _ = syscall.Syscall(syscall.SYS_FCNTL, file.Fd(), uintptr(fNoCache), 1)
}

func adviseInputFileDone(file *os.File) {
	_, _, _ = syscall.Syscall(syscall.SYS_FCNTL, file.Fd(), uintptr(fNoCache), 0)
}
