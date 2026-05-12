//go:build !windows
// +build !windows

package main

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"io/ioutil"
	"os"
	"os/exec"
	"runtime"
	"strings"
)

func isWSL() bool {
	data, err := ioutil.ReadFile("/proc/version")
	if err != nil {
		return false
	}
	return bytes.Contains(data, []byte("microsoft"))
}

func getClipboardImage() ([]byte, error) {
	var cmd *exec.Cmd
	switch {
	case runtime.GOOS == "darwin":
		cmd = exec.Command("pngpaste", "-")
	case isWSL():
		powershell := "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
		cmd = exec.Command(powershell, "-NoProfile", "-STA", "-Command",
			"$img = Get-Clipboard -Format Image; "+
				"if ($img) { "+
				"Add-Type -AssemblyName System.Drawing; "+
				"$path = 'C:\\temp\\ccimg-clipboard.png'; "+
				"if (!(Test-Path 'C:\\temp')) { New-Item -ItemType Directory -Path 'C:\\temp' -Force | Out-Null }; "+
				"$img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); "+
				"$bytes = [System.IO.File]::ReadAllBytes($path); "+
				"[Convert]::ToBase64String($bytes) "+
				"} else { 'NoImage' }")
		cmd.Env = append(os.Environ(), "DISPLAY=:0")
	case os.Getenv("WAYLAND_DISPLAY") != "":
		cmd = exec.Command("wl-paste", "--type", "image/png")
	default:
		cmd = exec.Command("xclip", "-selection", "clipboard", "-target", "image/png", "-o")
	}

	out, err := cmd.Output()
	if err != nil || len(out) == 0 {
		return nil, fmt.Errorf("Clipboard is empty or does not contain an image")
	}

	if isWSL() {
		b64 := strings.TrimSpace(string(out))
		return base64.StdEncoding.DecodeString(b64)
	}
	return out, nil
}
