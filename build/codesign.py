#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

from hashlib import sha256
from pathlib import Path

try:
  import buildconfig
  HAS_BUILDCONFIG = True
except ImportError:
  HAS_BUILDCONFIG = False
  buildconfig = None

def get_signtool():
  """
  Get signtool/osslsigncode path
  Returns:
    (str): path to signtool.exe or path to osslsigncode
    (bool): is path pointing to signtool.exe (false means osslsigncode)
  """
  if HAS_BUILDCONFIG:
    signtool = buildconfig.substs.get('SIGNTOOL')
    if signtool:
      signtool_p = Path(signtool)
      if not signtool_p.exists():
        raise RuntimeError(f"buildconfig['SIGNTOOL']={signtool_p} not found!")
      return str(signtool_p), signtool_p.name.lower() == 'signtool.exe'

  osslsigncode = shutil.which('osslsigncode')
  if osslsigncode:
    return osslsigncode, False

  if sys.platform == 'win32':
    if HAS_BUILDCONFIG and hasattr(buildconfig, 'substs'):
      sdk_bin = buildconfig.substs.get('WINDOWSSDKBIN')
      if sdk_bin:
        signtool_p = Path(sdk_bin) / 'signtool.exe'
        if signtool_p.exists():
          return str(signtool_p), True
        else:
          print(f"buildconfig['WINDOWSSDKBIN']={sdk_bin} , {signtool_p} not found!", file=sys.stderr)

    home = Path.home()
    mozbuild_vs = home / ".mozbuild" / "vs"
    if mozbuild_vs.exists():
      candidates = list(mozbuild_vs.rglob("x64/signtool.exe"))
      if candidates:
        return str(candidates[0]), True

  raise RuntimeError("signtool not found! Install osslsigncode or fix Windows SDK detection")

def generate_self_signed_cert(pfx_path, password, x509_subject):
  """Generate self-signed certificate"""
  pfx_path.parent.mkdir(parents=True, exist_ok=True)

  with tempfile.TemporaryDirectory() as tmp:
    key_pem = Path(tmp) / "key.pem"
    cert_pem = Path(tmp) / "cert.pem"

    subprocess.run([
      "openssl", "req", "-x509", "-nodes", "-days", "365",
      "-newkey", "rsa:2048",
      "-keyout", str(key_pem),
      "-out", str(cert_pem),
      "-subj", x509_subject,
      "-sha256"
    ], check=True)

    subprocess.run([
      "openssl", "pkcs12", "-export",
      "-out", str(pfx_path),
      "-inkey", str(key_pem),
      "-in", str(cert_pem),
      "-passout", f"pass:{password}"
    ], check=True)

def sign_file(signtool, is_windows_signtool, filepath, cert_path, password, timestamp_url):
  """Sign a single PE file"""
  filepath_tmp = None
  if is_windows_signtool:
    cmd = [
      signtool, "sign",
      "/f", str(cert_path),
      "/p", password or "",
      "/fd", "sha256"
    ]
    if timestamp_url:
      cmd.extend(["/tr", timestamp_url, "/td", "sha256"])
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
    if timestamp_url:
      cmd.extend(["-ts", timestamp_url])

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

def timestamp_file(signtool, is_windows_signtool, filepath, timestamp_url):
  """Timestamp an already signed single PE file"""
  filepath_tmp = None
  if is_windows_signtool:
    cmd = [signtool, "timestamp", "/tr", timestamp_url, "/td", "sha256", str(filepath)]
  else:
    filepath_tmp = str(filepath.with_suffix(filepath.suffix + ".tmp"))
    cmd = [signtool, "add", "-ts", timestamp_url, "-in", str(filepath), "-out", filepath_tmp]

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

def verify_pe_signature(signtool, is_windows_signtool, filepath, allow_untrusted):
  """Returns True if signed, False otherwise"""
  cmd = [signtool, 'verify', '/pa' if is_windows_signtool else '-in', str(filepath)]
  result = subprocess.run(cmd, capture_output=True, text=True)
  if result.returncode == 0:
    return True

  # osslsigntool does not have '/as' option with allows untrusted signatures
  # If allowing untrusted, check if failure is specifically due to trust issues
  if allow_untrusted:
    stderr = result.stderr.lower().strip()
    trust_errors = [
      "certificate is not trusted",
      "self signed certificate",
      "unable to get local issuer certificate",
      "self-signed certificate",
      "not trusted by the trust provider",
      "untrusted root"
    ]
    if any(err in stderr for err in trust_errors):
      return True

  print(f"{filepath}\n  {result.stderr}", file=sys.stderr)
  return False

def get_input_files(input_path, exemptions_arg):
  exemptions = set()
  if exemptions_arg:
    exempt_path = Path(exemptions_arg)

    if exempt_path.exists():
      for line in exempt_path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
          # Normalize backslashes to forward slashes and lowercase
          exemptions.add(line.lower().replace('\\', '/'))
    else:
      exemptions = {
        name.strip().lower().replace('\\', '/')
        for name in exemptions_arg.split(',')
      }

  if exemptions:
    print(f"Exemptions: {exemptions}")

  if input_path.is_file():
    if input_path.suffix.lower() not in {'.exe', '.dll'}:
      raise RuntimeError(f"Input file is not a PE file: {input_path}")
    files_to_sign_ = [input_path]
    base_dir = input_path.parent
  else:
    files_to_sign_ = input_path.rglob('*')
    base_dir = input_path

  files_to_sign = []
  for f in files_to_sign_:
    if f.suffix.lower() not in {'.exe', '.dll'}:
      continue

    try:
      rel_path = f.relative_to(base_dir).as_posix()
    except ValueError:
      rel_path = f.name

    if rel_path not in exemptions:
      files_to_sign.append(rel_path)

  return base_dir, files_to_sign

def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--input', required=True, help='Directory to scan for PE files or a single PE file')
  parser.add_argument('--exemptions', default=None, help='File with exemptions or comma-separated list (paths relative to dist_dir)')
  parser.add_argument('--cert', default=None, help='PFX certificate path')
  parser.add_argument('--auto-generate-cert', action='store_true', help='Automatically generate self-signed signature')
  parser.add_argument('--password', default='', help='PFX password')
  parser.add_argument('--timestamp', default='')
  parser.add_argument('--airgap', default=None, help='Destination dir where to put archive with gathered binaries for airgapped signing')
  parser.add_argument('--allow-untrusted', action='store_true', help='Allow self-signed/untrusted signatures')
  args = parser.parse_args()

  input_path = Path(args.input).resolve()
  print(f"Signing binaries in: {input_path}")

  signtool, is_windows_signtool = get_signtool()
  print(f"Signing tool: {signtool}")

  timestamp_url = os.environ.get('SIGNING_TIMESTAMP_URL') or args.timestamp
  base_dir, files_to_sign = get_input_files(input_path, args.exemptions)

  if args.airgap:
    airgap_dir = Path(args.airgap)
    airgap_dir.mkdir(parents=True, exist_ok=True)
    if not airgap_dir.is_dir():
      raise RuntimeError(f"--airgap argument {airgap_dir} is not a directory")

    hashfile_name = 'hashes.sha256'
    if hashfile_name in files_to_sign:
      raise RuntimeError(F"Input files contain problematic and unexpected filename: {hashfile_name}")

    airgap_archive_name = airgap_dir / (input_path.name + '.zip')
    airgap_archive = zipfile.ZipFile(airgap_archive_name, 'w', zipfile.ZIP_DEFLATED)
    # checksum_file = base_dir / hashfile_name
    airgap_archive_signed = airgap_dir / (input_path.name + '.signed.zip')

    if airgap_archive_signed.exists():
      os.remove(airgap_archive_signed)

    checksums = []
    for f in files_to_sign:
      file_path = base_dir / f
      airgap_archive.write(file_path, f)
      checksums.append(sha256(file_path.read_bytes()).hexdigest() + '  ' + f)

    airgap_archive.writestr(hashfile_name, '\n'.join(checksums) + '\n')
    airgap_archive.close()

    if sys.platform == 'win32':
      subprocess.run(['explorer', str(airgap_dir)])
    elif sys.platform == 'darwin':
      subprocess.run(['open', str(airgap_dir)])
    else:
      subprocess.run(['xdg-open', str(airgap_dir)])

    while not airgap_archive_signed.exists():
      print(f"""
      =========================================================
      AIRGAP SIGNING CHECKPOINT
      =========================================================
      Archive with files to sign: {airgap_archive_name}
      Expecting to find signed archive: {airgap_archive_signed}
      =========================================================
      Press Enter to continue or Ctrl+C to abort.
      """)
      try:
        input()
      except KeyboardInterrupt:
        sys.exit(1)

    print(f"Extracting {airgap_archive_signed} to {base_dir}")
    with zipfile.ZipFile(airgap_archive_signed, 'r') as zf:
      if bad_file := zf.testzip():
        raise RuntimeError(f"CRC error in zip file: {bad_file}")
      zf.extractall(base_dir)

    if subprocess.run(['sha256sum', '--check', hashfile_name], cwd = base_dir).returncode != 0:
      raise RuntimeError(f"Checksum verification failed!")
    os.remove(base_dir / hashfile_name)

    for f in files_to_sign:
      if timestamp_url:
        if not timestamp_file(signtool, is_windows_signtool, base_dir / f, timestamp_url):
          raise RuntimeError(f"Failed to timestamp file: {f}")

  else: # not args.airgap
    cert_path = os.environ.get('SIGNING_CERTIFICATE_PFX') or args.cert
    password = os.environ.get('SIGNING_CERTIFICATE_PASSWORD') or args.password

    if not cert_path:
      raise RuntimeError("Supply certificate through SIGNING_CERTIFICATE_PFX or --cert")

    cert_path = Path(cert_path).resolve()
    if not cert_path.exists() and args.auto_generate_cert:
      x509_subject = os.environ.get('SIGNING_CERTIFICATE_AUTOGENERATED_X509_SUBJECT', "/CN=Ceno Browser Dev Build Certificate/O=eQualitie/OU=Dev Build/C=CA/ST=Quebec/L=Montreal/emailAddress=support@ceno.app")
      print(f"Generating self-signed cert: {cert_path}\n X.509 subject: {x509_subject}")
      generate_self_signed_cert(cert_path, password, x509_subject)

    if not cert_path.exists():
      raise RuntimeError(f"Certificate not found: {cert_path}")

    for f in files_to_sign:
      if not sign_file(signtool, is_windows_signtool, base_dir / f, cert_path, password, timestamp_url):
        raise RuntimeError(f"Failed to sign: {f}")

  verification_success = True
  for f in files_to_sign:
    signed_file_path = base_dir / f
    if not verify_pe_signature(signtool, is_windows_signtool, signed_file_path, args.allow_untrusted):
      verification_success = False
  if not verification_success:
    raise RuntimeError('Signed binary verification failed!')

if __name__ == '__main__':
  main()
