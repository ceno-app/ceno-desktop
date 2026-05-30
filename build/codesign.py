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

hashfile_name = 'hashes.sha256'

def collect_entries(input_paths, exempt_paths=None):
  exemptions = set()
  if exempt_paths:
    for raw in exempt_paths:
      if raw is None:
        continue
      normalized = raw.strip().lower().replace('\\', '/')
      if normalized:
        exemptions.add(normalized)
    if exemptions:
      print(f"Exemptions: {exemptions}")

  entries = []
  archive_names_seen = set()

  for raw in input_paths:
    input_path_raw = Path(raw)
    input_path = input_path_raw.resolve()
    if not input_path.exists():
      raise RuntimeError(f"Input not found: {input_path}")

    name_source = input_path_raw
    while name_source.name == '' and name_source != name_source.parent:
      name_source = name_source.parent
    zip_prefix = name_source.name
    if not zip_prefix:
      raise RuntimeError(
        f"Cannot determine a safe archive prefix for input: {raw!r}. "
        f"Use an explicit directory name instead of '.' or the root path."
      )

    is_file_input = input_path.is_file()

    if is_file_input:
      if input_path.suffix.lower() not in {'.exe', '.dll'}:
        raise RuntimeError(f"Input file is not a PE file: {input_path}")
      files_iter = [input_path]
      base_dir = input_path.parent
    else:
      files_iter = input_path.rglob('*')
      base_dir = input_path

    for f in files_iter:
      if f.suffix.lower() not in {'.exe', '.dll'}:
        continue

      try:
        rel_path = f.relative_to(base_dir).as_posix()
      except ValueError:
        rel_path = f.name

      rel_norm = rel_path.lower()
      if exemptions:
        exempted = False
        for ex in exemptions:
          if rel_norm == ex or rel_norm.startswith(ex + '/'):
            exempted = True
            break
        if exempted:
          continue

      if rel_path == hashfile_name:
        raise RuntimeError(f"Input contains problematic filename: {hashfile_name}")

      if is_file_input:
        archive_name = rel_path
      else:
        archive_name = f"{zip_prefix}/{rel_path}"

      if archive_name in archive_names_seen:
        raise RuntimeError(
          f"Duplicate archive path across inputs: {archive_name!r}. "
          f"Ensure input directories/files have unique base names or contain unique filenames."
        )
      archive_names_seen.add(archive_name)

      entries.append((base_dir, rel_path, archive_name))

  return entries

def main():
  parser = argparse.ArgumentParser()
  parser.add_argument('--name', default='binaries', help='Package name. Will be used as airgap .zip filename')
  parser.add_argument('--input', required=True, action='append',
                      help='File or directory to scan for PE files (path is relative to dist_dir). Can be used multiple times')
  parser.add_argument('--exempt', default=None, action='append',
                      help='File or directory to exempt from signing (path is relative to dist_dir). Can be used multiple times')
  parser.add_argument('--cert', default=None, help='PFX certificate path. Environment variable SIGNING_CERTIFICATE_PFX overrides this argument')
  parser.add_argument('--auto-generate-cert', action='store_true', help='Automatically generate self-signed signature')
  parser.add_argument('--password', default='', help='PFX password. Environment variable SIGNING_CERTIFICATE_PASSWORD overrides this argument')
  parser.add_argument('--timestamp', default='')
  parser.add_argument('--airgap', default=None, help='Destination dir where to put archive with gathered binaries for airgapped signing')
  parser.add_argument('--allow-untrusted', action='store_true', help='Allow self-signed/untrusted signatures')
  args = parser.parse_args()

  if not args.name or args.name in ('.', '..') or any(c in args.name for c in '\\/:*?"<>|\x00'):
    parser.error(f"Invalid --name, unsafe for use as filename: {args.name!r}")

  print(f"Signing binaries: {', '.join(args.input)}")

  signtool, is_windows_signtool = get_signtool()
  print(f"Signing tool: {signtool}")

  timestamp_url = os.environ.get('SIGNING_TIMESTAMP_URL') or args.timestamp
  entries = collect_entries(args.input, args.exempt)

  if args.airgap:
    airgap_dir = Path(args.airgap)
    airgap_dir.mkdir(parents=True, exist_ok=True)
    if not airgap_dir.is_dir():
      raise RuntimeError(f"--airgap argument {airgap_dir} is not a directory")

    abs_map = {}
    for base_dir, rel_path, archive_name in entries:
      abs_map[archive_name] = base_dir / rel_path

    airgap_archive_name = airgap_dir / (args.name + '.zip')
    airgap_archive_signed = airgap_dir / (args.name + '.signed.zip')

    if airgap_archive_signed.exists():
      os.remove(airgap_archive_signed)

    with zipfile.ZipFile(airgap_archive_name, 'w', zipfile.ZIP_DEFLATED) as zf:
      checksums = []
      for base_dir, rel_path, archive_name in entries:
        file_path = base_dir / rel_path
        zf.write(file_path, archive_name)
        checksums.append(sha256(file_path.read_bytes()).hexdigest() + '  ' + archive_name)

      zf.writestr(hashfile_name, '\n'.join(checksums) + '\n')

    if sys.platform == 'win32':
      subprocess.run(['explorer', str(airgap_dir)])
    elif sys.platform == 'darwin':
      subprocess.run(['open', str(airgap_dir)])
    else:
      subprocess.run(['xdg-open', str(airgap_dir)])

    while not airgap_archive_signed.exists():
      print(f"""
==============================================================
AIRGAP SIGNING CHECKPOINT
==============================================================
Archive with files to sign: {airgap_archive_name}
Expecting signed archive:   {airgap_archive_signed}

On the air-gapped machine run:
  ./build/codesign-on-airgapped-machine.py \\
      --input-zip  {airgap_archive_name} \\
      --output-zip {airgap_archive_signed}
==============================================================
Press Enter to continue or Ctrl+C to abort.
""")
      try:
        input()
      except KeyboardInterrupt:
        sys.exit(1)

    with zipfile.ZipFile(airgap_archive_signed, 'r') as zf:
      print(f"Reading {airgap_archive_signed}")
      if bad_file := zf.testzip():
        raise RuntimeError(f"CRC error in zip file: {bad_file}")

      for info in zf.infolist():
        if info.filename == hashfile_name:
          continue
        abs_path = abs_map.get(info.filename)
        if not abs_path:
          raise RuntimeError(f"Signed archive contains unexpected file: {info.filename}")
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(abs_path, 'wb') as dst:
          shutil.copyfileobj(src, dst)

      if hashfile_name not in zf.namelist():
        raise RuntimeError(f"Signed archive missing {hashfile_name}")
      for line in zf.read(hashfile_name).decode().splitlines():
        if not line.strip():
          continue
        expected_hash, _, filename = line.partition('  ')
        abs_path = abs_map.get(filename)
        if not abs_path or not abs_path.exists():
          raise RuntimeError(f"Missing file for checksum verification: {filename}")
        actual_hash = sha256(abs_path.read_bytes()).hexdigest()
        if actual_hash != expected_hash:
          raise RuntimeError(f"Checksum verification failed for {abs_path}")

    for base_dir, rel_path, archive_name in entries:
      if timestamp_url:
        if not timestamp_file(signtool, is_windows_signtool, base_dir / rel_path, timestamp_url):
          raise RuntimeError(f"Failed to timestamp file: {base_dir / rel_path}")

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

    for base_dir, rel_path, archive_name in entries:
      filepath = base_dir / rel_path
      if not sign_file(signtool, is_windows_signtool, filepath, cert_path, password, timestamp_url):
        raise RuntimeError(f"Failed to sign: {filepath}")

  verification_success = True
  for base_dir, rel_path, archive_name in entries:
    signed_file_path = base_dir / rel_path
    if not verify_pe_signature(signtool, is_windows_signtool, signed_file_path, args.allow_untrusted):
      verification_success = False

  if not verification_success:
    raise RuntimeError('Signed binary verification failed!')

if __name__ == '__main__':
  main()
