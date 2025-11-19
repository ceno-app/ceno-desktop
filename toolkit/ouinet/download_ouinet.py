import os
import sys
import zipfile

import requests


def download_file(url, output_dir):
    """Download a file from the given URL and save it to the output directory."""
    os.makedirs(output_dir, exist_ok=True)
    local_filename = os.path.join(output_dir, url.split("/")[-1])

    print(f"Downloading {url}...")
    with requests.get(url, stream=True) as response:
        response.raise_for_status()
        with open(local_filename, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
    print(f"Downloaded {local_filename}")
    return local_filename


def unpackage_file(zfile, output_dir):
    """Unzip downloaded file in the given directory."""
    with zipfile.ZipFile(zfile, "r") as ouinet_zip:
        for member in ouinet_zip.namelist():
            # Check if the file is in the 'build/windows' directory
            if member.startswith("ouinet-windows-x64-v1.4.2/") and not member.endswith("/"):
                # Extract the file to the output directory, stripping 'build/windows/'
                relative_path = os.path.relpath(member, "ouinet-windows-x64-v1.4.2")
                target_path = os.path.join(output_dir, relative_path)
                # Ensure the target directory exists
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                # Extract the file
                with ouinet_zip.open(member) as source, open(
                    target_path, "wb"
                ) as target:
                    target.write(source.read())
    os.remove(zfile)


def main():
    # Check if the output path is provided
    if len(sys.argv) != 2:
        print("Usage: download_ouinet.py <output_dir>")
        sys.exit(1)

    output_dir = sys.argv[1]
    ouinet_url = (
        "https://gitlab.com/equalitie/ouinet/-/package_files/248309764/download"
    )
    print(f"Downloading and extracting ouinet artifacts at {output_dir}...")
    try:
        unpackage_file(download_file(ouinet_url, output_dir), output_dir)
        print(f"Ouinet ready at {output_dir}.")
    except Exception as e:
        print(f"Failed to get the Ouinet files ready: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
