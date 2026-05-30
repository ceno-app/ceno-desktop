#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

from pathlib import Path
from hashlib import sha256

def get_signtool():
  """
  Get signtool/osslsigncode path
  Returns:
    (str): path to signtool.exe or path to osslsigncode
    (bool): is path pointing to signtool.exe (false means osslsigncode)
  """
  osslsigncode = shutil.which('osslsigncode')
  if osslsigncode:
    return osslsigncode, False

  if sys.platform == 'win32':
    home = Path.home()
    mozbuild_vs = home / ".mozbuild" / "vs"
    if mozbuild_vs.exists():
      candidates = list(mozbuild_vs.rglob("x64/signtool.exe"))
      if candidates:
        return str(candidates[0]), True

  raise RuntimeError("signtool not found! Install osslsigncode or fix Windows SDK detection")

def sign_file(signtool, is_windows_signtool, filepath, cert_path, password):
  """Sign a single PE file"""
  filepath_tmp = None
  if is_windows_signtool:
    cmd = [
      signtool, "sign",
      "/f", str(cert_path),
      "/p", password or "",
      "/fd", "sha256"
    ]
    cmd.append(str(filepath))
  else:
    filepath_tmp = str(filepath.with_suffix(filepath.suffix + ".tmp"))
    cmd = [
      signtool, "sign",
      "-pkcs12", str(cert_path),
      "-pass", password or "",
      "-n", "Ceno Browser",
      "-i", "https://equalitie.org",
      "-in", str(filepath),
      "-out", filepath_tmp
    ]

  result = subprocess.run(cmd, capture_output=True, text=True)
  if result.returncode == 0:
    if filepath_tmp:
      os.replace(filepath_tmp, str(filepath))
    return True
  print(result.stdout, file=sys.stderr)
  print(result.stderr, file=sys.stderr)
  if filepath_tmp and Path(filepath_tmp).exists():
    os.remove(filepath_tmp)

  return False

def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--input-zip', required=True, help='ZIP file containing files to be signed')
  parser.add_argument('--output-zip', required=True, help='ZIP file containing signed files')
  parser.add_argument('--cert', default=None, help='PFX certificate path. Environment variable SIGNING_CERTIFICATE_PFX overrides this argument')
  parser.add_argument('--password', default='', help='PFX password. Environment variable SIGNING_CERTIFICATE_PASSWORD overrides this argument')

  args = parser.parse_args()

  signtool, is_windows_signtool = get_signtool()
  print(f"Signing tool: {signtool}")

  cert_path = os.environ.get('SIGNING_CERTIFICATE_PFX') or args.cert
  password = os.environ.get('SIGNING_CERTIFICATE_PASSWORD') or args.password

  if not cert_path:
    raise RuntimeError("Supply certificate through SIGNING_CERTIFICATE_PFX or --cert")

  input_zip = args.input_zip
  print(f"Verifying ZIP file hashes: {input_zip}");

  with tempfile.TemporaryDirectory() as tmp:
    files_to_sign = []
    tmp_path = Path(tmp)
    with zipfile.ZipFile(input_zip, 'r') as zf:
      if bad_file := zf.testzip():
        raise RuntimeError(f"CRC error in zip file: {bad_file}")

      hashfile_name = 'hashes.sha256'
      for member in zf.namelist():
        if member.endswith('/'):
          continue

        target = (tmp_path / member).resolve()
        try:
          target.relative_to(tmp_path.resolve())
        except ValueError:
          raise RuntimeError(f"Blocked dangerous path: {member}")

        if member == hashfile_name:
          zf.extract(member, tmp_path)
        elif member.lower().endswith(('.exe', '.dll')):
          zf.extract(member, tmp_path)
          files_to_sign.append(target)

      if not files_to_sign:
        raise RuntimeError("No .exe or .dll files found in input ZIP")

    hashfile = tmp_path / hashfile_name
    if subprocess.run(['sha256sum', '--check', str(hashfile)], cwd=tmp).returncode != 0:
      raise RuntimeError(f"Checksum verification failed!")
    os.remove(hashfile)

    output_zip_path = Path(args.output_zip)
    print(f"Writing output to {output_zip_path}")

    output_zip_temp = tmp_path / 'signed.tmp.zip'
    with zipfile.ZipFile(output_zip_temp, 'w', zipfile.ZIP_DEFLATED) as output_zf:
      checksums = []
      for f in files_to_sign:
        if not sign_file(signtool, is_windows_signtool, f, cert_path, password):
          raise RuntimeError(f"Failed to sign: {f}")
        rel_path = f.relative_to(tmp_path).as_posix()
        checksums.append(sha256(f.read_bytes()).hexdigest() + '  ' + rel_path)
        output_zf.write(f, rel_path)

      output_zf.writestr(hashfile_name, '\n'.join(checksums) + '\n')

    output_zip_parent_path = output_zip_path.parent
    output_zip_parent_path.mkdir(parents=True, exist_ok=True)
    output_zip_parent_path = output_zip_parent_path.resolve()
    shutil.move(str(output_zip_temp), str(output_zip_path))

    if sys.platform == 'win32':
      subprocess.run(['explorer', str(output_zip_parent_path)])
    elif sys.platform == 'darwin':
      subprocess.run(['open', str(output_zip_parent_path)])
    else:
      subprocess.run(['xdg-open', str(output_zip_parent_path)])

if __name__ == '__main__':
  main()
