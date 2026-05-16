//go:build !darwin && !linux

package main

import "os"

func adviseInputFileStart(file *os.File) {}

func adviseInputFileDone(file *os.File) {}
