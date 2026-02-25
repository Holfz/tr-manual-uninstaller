/* Dependencies */
const { readFileSync, readdirSync, statSync, unlinkSync } = require("fs");
const { join } = require("path");
const { createHash } = require("crypto");
const { execSync } = require("child_process");
const prompts = require("prompts");
const ora = require("ora");
const chalk = require("chalk");

// Deny if the platform is not Windows, Why would they want to install TalesRunner on any os other than Windows !?
if (process.platform !== "win32") {
   console.log(chalk.red("This tool only supports Windows."));
   process.exit(1);
}

/* Main */
(async function() {
   // Load known files from the TR files list
   const trFiles = new Map(readFileSync(join(__dirname, "data", "trFiles.csv"), "utf8") // Read CSV file as UTF-8 string
      // Remove leading/trailing whitespace
      .trim()

      // Split into lines (handles both LF and CRLF)
      .split(/\r?\n/)

      // Skip the header row
      .slice(1)

      // Then map each line to a [key, value] pair for the Map
      .map((l) => {
         // Extract name, hash, size from CSV columns
         const [, name, , hash, size] = l.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)"$/);

         // Return [key, value] pair.
         return [name.toLowerCase(), { hash, size: Number(size) }];
      }));

   // Log how many files were loaded
   console.log(`${chalk.green("✔")} Loaded ${chalk.bold(trFiles.size)} known files from the TR files list.\n`);

   // Detect all mounted drives by testing A-Z
   const drives = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") // All possible drive letters
      // Format as drive root (e.g. "C:\")
      .map((l) => l + ":\\")

      // Keep only accessible drives
      .filter((d) => { try { statSync(d); return true; } catch { return false; } });

   // Scan root of each drive for matching files
   const matches = [];
   const spinner = ora();

   // Iterate over each drive
   for (const drive of drives) {
      spinner.start(`Scanning ${drive}...`);
      let entries;

      // Read drive root entries, skip if inaccessible
      try {
         // List all entries at the drive root
         entries = readdirSync(drive);
      } catch {
         // Warn and skip inaccessible drives
         spinner.warn(`Unable to scan ${drive}, skipping.`);
         continue;
      }

      // Iterate over each entry in the drive root
      for (const entry of entries) {
         // Check if the file name matches a known TR file
         const known = trFiles.get(entry.toLowerCase());

         // Skip if name doesn't match any known file
         if (!known) {
            continue;
         }

         // Build the full path
         const fullPath = join(drive, entry);

         // Get file stats, skip if inaccessible
         let stat;
         try {
            stat = statSync(fullPath); // Get file metadata
         } catch {
            continue; // Skip if unable to stat the file
         }

         // Skip directory entries
         if (stat.isDirectory()) {
            continue; // Only match files, not directories
         }

         // Check if size matches
         if (stat.size !== known.size) {
            continue; // Skip if file size doesn't match expected size
         }

         // Compute SHA256 hash and check if it matches
         const fileHash = createHash("sha256")
            // Feed the file contents into it
            .update(readFileSync(fullPath))

            // Get the hex digest
            .digest("hex")

            // Convert to uppercase to match CSV format
            .toUpperCase();

         // Skip if hash doesn't match expected hash
         if (fileHash !== known.hash) {
            continue;
         }

         // All checks passed, add to matches
         matches.push({ path: fullPath, hash: known.hash, size: known.size });
      }

      // Mark drive scan as complete
      spinner.succeed(`Scanned ${drive} (${entries.length} entries)`);
   }

   // Log how many matching files were found
   console.log(`\n${chalk.yellow(`Found ${chalk.bold(matches.length)} matching file(s) at the root drive.`)}`);

   // Exit early if no matches found
   if (matches.length === 0) {
      return;
   }

   // Group matches by drive for tree display
   const grouped = new Map();
   for (const m of matches) {
      // Extract drive root (e.g. "C:\")
      const drive = m.path.slice(0, 3);

      // Initialize array if first match for this drive
      if (!grouped.has(drive)) grouped.set(drive, []);

      // Add match to the drive's array
      grouped.get(drive).push(m);
   }

   // Display matched files as a tree
   for (const [drive, files] of grouped) {
      console.log(chalk.bold.blue(`Drive: ${drive}`));

      // Loop each file in drive
      for (let i = 0; i < files.length; i++) {
         // Check if this is the last file in the group
         const isLast = i === files.length - 1;

         // Extract file name (remove drive prefix)
         const name = files[i].path.slice(3);

         // Print file with metadata
         console.log(`${chalk.dim(isLast ? "└── " : "├── ")}${chalk.white(name)} ${chalk.dim(`(Size: ${files[i].size} bytes, SHA256: ${files[i].hash})`)}`);
      }
   }
   console.log('\n');

   // Prompt user to confirm deletion
   const { confirm } = await prompts({
      type: "confirm",
      name: "confirm",
      message: `Delete these ${matches.length} file(s)?`,
      initial: false,
   });

   // Exit if user declined
   if (!confirm) {
      console.log(chalk.yellow("Aborted. No files were deleted.\n")); // Show abort message in yellow
      return;
   }
   console.log();

   // Delete confirmed files
   let deleted = 0;
   for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      spinner.start(`Deleting (${i + 1}/${matches.length}) ${m.path}`);
      try {
         // Try to delete the file, may throw if file is in use or permission denied
         unlinkSync(m.path);

         // Mark as successfully deleted
         spinner.succeed(`Deleted ${m.path}`);
         deleted++; // Increment success counter
      } catch (err) {
         // Show error if deletion failed
         spinner.fail(`Failed ${m.path}: ${err.message}`);
      }
   }

   // Log deletion summary
   console.log(`\n${chalk.green.bold("Done.")} ${deleted}/${matches.length} file(s) deleted.\n`);

   // Search for TalesRunner registry entry in Apps & Features (Uninstall keys)
   const uninstallPaths = [
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", // 64-bit programs
      "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall", // 32-bit programs on 64-bit Windows
      "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall", // Per-user installations
   ];

   spinner.start("Searching for TalesRunner registry entry...");
   let foundKey = null;

   // Iterate over each uninstall registry path
   for (const regPath of uninstallPaths) {
      // List all subkeys under the uninstallation path
      let subkeys;
      try {
         subkeys = execSync(`reg query "${regPath}"`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] })
            .trim().split(/\r?\n/).filter(Boolean);
      } catch {
         // Skip if registry path doesn't exist
         continue;
      }

      // Check each subkey for DisplayName matching TalesRunner
      for (const subkey of subkeys) {
         try {
            // Read DisplayName value
            const output = execSync(`reg query "${subkey}" /v DisplayName`, { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] });

            // Case-insensitive match for "TalesRunner"
            if (/talesrunner/i.test(output)) {
               // Store the matching key path
               foundKey = subkey.trim();

               // Stop searching once found
               break;
            }
         } catch {
            // Skip if subkey doesn't have DisplayName
            continue;
         }
      }

      // Stop searching other paths once found
      if (foundKey) {
         break;
      }
   }

   // Handle case where no registry entry was found
   if (!foundKey) {
      spinner.info("No TalesRunner registry entry found in Apps & Features.");
      console.log();
      return;
   }

   // Show found registry entry
   spinner.succeed(`Found registry entry: ${foundKey}`);
   console.log();

   // Prompt user to confirm registry removal
   const { confirmReg } = await prompts({
      type: "confirm",
      name: "confirmReg",
      message: `Remove this registry entry to unlist from Apps & Features?`,
      initial: false,
   });

   // Exit if user declined
   if (!confirmReg) {
      console.log(chalk.yellow("Registry entry was not removed.\n"));
      return;
   }

   // Delete the registry key
   spinner.start("Removing registry entry...");
   try {
      // Force delete without confirmation
      execSync(`reg delete "${foundKey}" /f`, { stdio: "ignore" });

      // Mark as successfully removed
      spinner.succeed(`Removed registry entry: ${foundKey}`);
   } catch (err) {
      // Show error if removal failed
      spinner.fail(`Failed to remove registry entry: ${err.message}`);
   }
   console.log();

   // Search for Windows Installer (MSI) product registration
   spinner.start("Searching for TalesRunner Windows Installer registration...");

   // Search all MSI-related registry paths
   const msiSearchPaths = [
      "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\UserData", // MSI product installation data
      "HKLM\\SOFTWARE\\Classes\\Installer\\Products", // Advertised MSI products
      "HKLM\\SOFTWARE\\Classes\\Installer\\Features", // Advertised MSI features
      "HKLM\\SOFTWARE\\Classes\\Installer\\UpgradeCodes", // MSI upgrade tracking
      "HKCU\\SOFTWARE\\Microsoft\\Installer\\Products", // Per-user MSI products
      "HKCU\\SOFTWARE\\Microsoft\\Installer\\Features", // Per-user MSI features
   ];

   // Iterate over each MSI search path
   const msiKeys = [];
   for (const searchPath of msiSearchPaths) {
      try {
         // Recursively search for TalesRunner in values
         const output = execSync(
            `reg query "${searchPath}" /s /f "Talesrunner" /d`,
            { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
         );

         // Parse the output to extract matching key paths
         for (const line of output.trim().split(/\r?\n/)) {
            const trimmed = line.trim();

            // We expect lines with the format: "HKEY_...\ValueName    REG_SZ    ValueData"
            if (!trimmed || !trimmed.startsWith("HKEY_")) continue;

            // Only process lines that are registry key paths
            // Go up to the product GUID key (parent of InstallProperties/etc)
            const parent = trimmed.replace(/\\[^\\]+$/, ""); // Remove the last path segment

            // Avoid duplicates
            if (!msiKeys.includes(parent)) {
               // Add to the list of keys to remove
               msiKeys.push(parent);
            }
         }
      } catch {
         // No results found in this path
      }
   }

   // Handle case where no MSI registration was found
   if (msiKeys.length === 0) {
      spinner.info("No Windows Installer registration found for TalesRunner.");
      console.log();
      return;
   }

   // Display found MSI keys
   spinner.succeed(`Found ${msiKeys.length} Windows Installer registration(s):`);
   for (const key of msiKeys) {
      console.log(`  ${key}`);
   }
   console.log();

   // Prompt user to confirm MSI registry removal
   const { confirmMsi } = await prompts({
      type: "confirm",
      name: "confirmMsi",
      message: `Remove Windows Installer registration(s) to stop repair/remove prompts?`,
      initial: false,
   });

   // Exit if user declined
   if (!confirmMsi) {
      console.log(chalk.yellow("Windows Installer registration was not removed.\n"));
      return;
   }

   // Delete the MSI registry keys
   for (const key of msiKeys) {
      spinner.start(`Removing ${key}...`);
      try {
         // Force delete without confirmation
         execSync(`reg delete "${key}" /f`, { stdio: "ignore" });

         // Mark as successfully removed
         spinner.succeed(`Removed ${key}`);
      } catch (err) {
         // Show error if removal failed
         spinner.fail(`Failed to remove ${key}: ${err.message}`);
      }
   }

   // Show final completion message
   console.log(`\n${chalk.green.bold("Manual cleanup completed.")}`);
}()).finally(async () => {
   // Wait for any key before closing (prevents console from closing immediately when run as .exe)
   console.log(`\n${chalk.dim("Press any key to exit...")}`);
   process.stdin.setRawMode(true);
   process.stdin.resume();
   await new Promise((resolve) => process.stdin.once("data", resolve));
   process.exit();
});
