//go:build windows
// +build windows

package main

import (
	"encoding/binary"
	"fmt"
	"syscall"
	"unsafe"
)

const (
	CF_DIB     = 8
	CF_DIBV5   = 17
	CF_BITMAP  = 2
)

var (
	user32  = syscall.NewLazyDLL("user32.dll")
	kernel32 = syscall.NewLazyDLL("kernel32.dll")

	procOpenClipboard            = user32.NewProc("OpenClipboard")
	procCloseClipboard           = user32.NewProc("CloseClipboard")
	procGetClipboardData         = user32.NewProc("GetClipboardData")
	procIsClipboardFormatAvailable = user32.NewProc("IsClipboardFormatAvailable")
	procGlobalLock               = kernel32.NewProc("GlobalLock")
	procGlobalUnlock             = kernel32.NewProc("GlobalUnlock")
	procGlobalSize               = kernel32.NewProc("GlobalSize")
)

func getClipboardImage() ([]byte, error) {
	// Check CF_DIB first, then CF_DIBV5
	var format uint32
	r1, _, _ := procIsClipboardFormatAvailable.Call(CF_DIB)
	if r1 != 0 {
		format = CF_DIB
	} else {
		r1, _, _ = procIsClipboardFormatAvailable.Call(CF_DIBV5)
		if r1 != 0 {
			format = CF_DIBV5
		} else {
			return nil, fmt.Errorf("Clipboard is empty or does not contain an image")
		}
	}

	r1, _, _ = procOpenClipboard.Call(0)
	if r1 == 0 {
		return nil, fmt.Errorf("OpenClipboard failed")
	}
	defer procCloseClipboard.Call()

	hMem, _, _ := procGetClipboardData.Call(uintptr(format))
	if hMem == 0 {
		return nil, fmt.Errorf("GetClipboardData failed")
	}

	pMem, _, _ := procGlobalLock.Call(hMem)
	if pMem == 0 {
		return nil, fmt.Errorf("GlobalLock failed")
	}
	defer procGlobalUnlock.Call(hMem)

	size, _, _ := procGlobalSize.Call(hMem)
	if size == 0 {
		return nil, fmt.Errorf("GlobalSize returned 0")
	}

	// Copy DIB data
	src := (*(*[1 << 30]byte)(unsafe.Pointer(pMem)))[:size]
	dib := make([]byte, size)
	copy(dib, src)

	// Convert DIB to BMP by adding a 14-byte BMP file header
	bmpHeader := make([]byte, 14)
	bmpHeader[0] = 'B'
	bmpHeader[1] = 'M'
	binary.LittleEndian.PutUint32(bmpHeader[2:6], uint32(14+size))
	binary.LittleEndian.PutUint32(bmpHeader[10:14], 14)

	return append(bmpHeader, dib...), nil
}
