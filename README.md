# tr-manual-uninstaller

## THE OFFICIAL HAS RELEASED AN OFFICIAL SOLUTION TO DELETE GAME FILES: https://talesrunner.thehof.gg/news/howto-download-th; THIS IS AN UNOFFICIAL SOLUTION AND SHOULD NOT BE USED.

https://github.com/user-attachments/assets/0e635529-9fc1-48b2-8e68-025bd57462b3

## Overview

tr-manual-uninstaller is a tool for cleanly removing root drive installed TalesRunner from your PC

## Why does this exist?

The official uninstaller has a bug where it can delete everything on the drive when the game is installed in the root (e.g. `C:\`).

This tool is a safer alternative that only targets known TalesRunner files and leaves everything else alone.

I understand the paranoia. So **every single line of code is commented** explaining exactly what it does. Feel free to audit it.

## How it works?

1. The application will scan at the root of every mounted drive (C:\, D:\, E:\, etc.) for files that match known TalesRunner files. It uses a combination of file name, size, and SHA256 hash to ensure it only targets the correct files.
2. It then presents you with a tree view of all the matched files, showing their sizes and hashes so you can review them before taking any action.
3. You can then choose to delete the matched files. The application will ask for confirmation before deleting anything, and it will only delete the files that were matched in the previous step.
4. Finally, it will clean up the registry by removing the Apps & Features entry and Windows Installer registration for TalesRunner, ensuring that your system doesn't think the game is still installed.

## Is it safe?

It only matches files by **name + size + SHA256 hash**  all three condition must match before a file is even considered. It won't accidentally delete your files that happen to share a name with a TalesRunner file.

It then **asks for confirmation** before every destructive action (file deletion, registry removal).

## How the file hash is gathered?

First, I have install the game in a VM and collected the file list, and then gather the size and SHA256 hash for each file with this powershell command:

```powershell
Get-ChildItem -Path "C:\TalesRunner_Installation_Path" -File -Recurse | ForEach-Object {
    [PSCustomObject]@{
        FileName = $_.Name
        Path     = $_.FullName
        SHA256   = (Get-FileHash -Path $_.FullName -Algorithm SHA256).Hash
        Size     = $_.Length
    }
} | Export-Csv -Path "C:\FileHashes.csv" -NoTypeInformation
```

The csv file is included in the repo for reference. The application uses this list to match files on the user's system.

## How to use

### Option 1: Download the exe

Grab `tr-manual-uninstaller.exe` from the releases page and run it as Administrator.

### Option 2: Run from source

```bash
npm install
node index.js
```

> You'll need to run your terminal as Administrator for the registry cleanup steps to work.

## Building the exe yourself

If you don't trust the prebuilt exe (totally fair), you can build it yourself:

```bash
npm install
npm run build
```

The exe will be in the `dist/` folder.

## Legals

- All trademarks belong to their respective owners.
- This project is not affiliated with Rhaon Entertainment Co., Ltd. and Hall Of Fame Co., Ltd. or any of its employees.
- TalesRunner is a registered trademark of Rhaon Entertainment Co., Ltd., Game assets, materials and icons belong to Rhaon Entertainment Co., Ltd.
- Rhaon Entertainment Co., Ltd. and Hall Of Fame Co. do not endorse the content of this project nor are responsible for this project.
- This project is not intended for commercial use and should only be used by individuals who have legally obtained TalesRunner and wish to uninstall it safely.
