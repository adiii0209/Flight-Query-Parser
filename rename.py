import os
import csv
import re
import sys
import io

# Set stdout to handle UTF-8 to prevent crashes with special characters in filenames
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def rename_files():
    # Use absolute path to ensure it finds the file in the script's directory
    script_dir = os.path.dirname(os.path.abspath(__file__))
    names_file = os.path.join(script_dir, 'names.txt')
    
    if not os.path.exists(names_file):
        print(f"Error: {names_file} not found.")
        return

    # Load names and serial numbers from names.txt
    name_map = []
    try:
        with open(names_file, 'r', encoding='utf-8-sig') as f:
            reader = csv.reader(f)
            for row in reader:
                if not row: continue
                parts = row[0].split(',', 1) if (len(row) == 1 and ',' in row[0]) else row
                if len(parts) >= 2:
                    serial = parts[0].strip()
                    full_name = parts[1].strip()
                    if serial and full_name:
                        # Use capital D for the serial
                        clean_serial = serial.lstrip('Dd')
                        formatted_serial = f"D{clean_serial}"
                        name_map.append((formatted_serial, full_name))
    except Exception as e:
        print(f"Error reading {names_file}: {e}")
        return

    files = [f for f in os.listdir(script_dir) if os.path.isfile(os.path.join(script_dir, f))]
    renamed_count = 0
    for filename in files:
        if filename.lower() in ['names.txt', 'rename.py']: continue
            
        matched_prefix = None
        for prefix, full_name in name_map:
            # Match by full name
            if full_name.lower() in filename.lower():
                matched_prefix = prefix
                break
            
            # Match by lowercase d pattern (fix previous batch)
            # prefix is "D1", wrong_prefix is "d1"
            wrong_prefix = f"d{prefix[1:]}"
            if filename.startswith(f"{wrong_prefix} FLIGHT"):
                matched_prefix = prefix
                break
        
        if matched_prefix:
            base, ext = os.path.splitext(filename)
            new_filename = f"{matched_prefix} FLIGHT{ext}"
            
            if filename != new_filename:
                old_path = os.path.join(script_dir, filename)
                new_path = os.path.join(script_dir, new_filename)
                
                try:
                    if filename.lower() == new_filename.lower():
                        # Only case change, safe to rename on Windows
                        os.rename(old_path, new_path)
                        print(f"Renamed (Case): {filename} -> {new_filename}")
                        renamed_count += 1
                    elif os.path.exists(new_path):
                        print(f"Skipping: {new_filename} already exists")
                        continue
                    else:
                        os.rename(old_path, new_path)
                        print(f"Renamed: {filename} -> {new_filename}")
                        renamed_count += 1
                except Exception as e:
                    print(f"Error renaming {filename}: {e}")
            else:
                print(f"Skipping (already correct): {filename}")

    print(f"\nFinished. Total files renamed: {renamed_count}")

if __name__ == "__main__":
    rename_files()
