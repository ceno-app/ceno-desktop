#include "nsString.h"

#include <format>
#include <optional>
#include <windows.h>

#include <appmodel.h>
#include <winnls.h>

#include "OuinetNativeHelpers.h"

namespace mozilla {

static std::optional<std::wstring> getPackageFamilyName() {
  UINT32 nameLen = 0;
  LONG rc = GetCurrentPackageFamilyName(&nameLen, NULL);

  if (rc != ERROR_INSUFFICIENT_BUFFER) {
    return {};
  }
  std::wstring familyName(nameLen, L'\0');

  rc = GetCurrentPackageFamilyName(&nameLen, familyName.data());
  if (rc != ERROR_SUCCESS) {
    return {};
  }

  // trim extra null terminator, if there is
  familyName.resize(wcsnlen(familyName.c_str(), familyName.size()));

  return familyName;
}

static std::optional<std::wstring> getUserShellFolderRegValue(const wchar_t *regKey) {
  constexpr const wchar_t *subKey = L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";
  DWORD bufferSize = 0;

  if (ERROR_SUCCESS != RegGetValueW(HKEY_CURRENT_USER, subKey, regKey,
                                    RRF_RT_REG_EXPAND_SZ | RRF_RT_REG_SZ, nullptr, nullptr, &bufferSize)) {
    return {};
  }

  // RegGetValueW uses bytes, not count of chars, divide size by 2
  std::wstring buffer(bufferSize / sizeof(wchar_t), L'-');
  if (ERROR_SUCCESS != RegGetValueW(HKEY_CURRENT_USER, subKey, regKey,
                                    RRF_RT_REG_EXPAND_SZ | RRF_RT_REG_SZ, nullptr, buffer.data(), &bufferSize)) {
    return {};
  }
  // RegGetValueW returned size is larger than real data.
  // There is some junk after null terminator.
  // wcslen to clean it up.
  buffer.resize(wcsnlen(buffer.c_str(), buffer.size()));

  return buffer;
}

static std::optional<std::wstring> getEnvValue(const wchar_t *envKey) {
  DWORD bufferSize = GetEnvironmentVariableW(envKey, NULL, 0);
  if (0 == bufferSize) {
    return {};
  }

  std::wstring buffer(bufferSize, L'\0');

  bufferSize = GetEnvironmentVariableW(envKey, buffer.data(), bufferSize);
  if (0 == bufferSize) {
    return {};
  }

  // trim extra null terminator, if there is
  buffer.resize(wcsnlen(buffer.c_str(), buffer.size()));

  return buffer;
}

static std::optional<std::wstring> getLocalAppData() {
  auto localAppData = getUserShellFolderRegValue(L"Local AppData");
  if (localAppData.has_value()) {
    return localAppData;
  }

  return getEnvValue(L"LOCALAPPDATA");
}

static std::optional<std::wstring> getRoamingAppData() {
  auto localAppData = getUserShellFolderRegValue(L"AppData");
  if (localAppData.has_value()) {
    return localAppData;
  }

  return getEnvValue(L"APPDATA");
}

static std::wstring getShortPath(const std::wstring &longPath) {
  DWORD length = GetShortPathNameW(longPath.c_str(), nullptr, 0);
  if (length > 0) {
    std::wstring shortPath(length, L'\0');
    length = GetShortPathNameW(longPath.c_str(), shortPath.data(), shortPath.size());
    if (length > 0) {
      // trim extra null terminator, if there is
      shortPath.resize(wcsnlen(shortPath.c_str(), shortPath.size()));
      return shortPath;
    }
  }
  return longPath;
}

NS_IMETHODIMP
OuinetNativeHelpers::GetShortPath(const nsAString &longPath, nsAString &shortPath) {
  // nsAString may not be null terminated.
  const std::wstring longPathStr{
    reinterpret_cast<const wchar_t *>(longPath.BeginReading()),
    longPath.Length()
  };
  const std::wstring shortPathStr = getShortPath(longPathStr);
  shortPath.Assign(shortPathStr.c_str(), shortPathStr.length());
  return NS_OK;
}

// Requested by browser (virtual app data):
// C:\Users\u\AppData\Roaming\eQualitie\Ceno Alpha
// (roaming)AppData:
// C:\Users\u\AppData\Roaming
// AppDataLocal with package family name:
// C:\Users\u\AppData\Local\Packages\ceno_5e75r73jvfq74\LocalCache\Roaming
// Real app Data:
// C:\Users\u\AppData\Local\Packages\ceno_5e75r73jvfq74\LocalCache\Roaming\eQualitie\Ceno Alpha
// Final result (short path)
// @TODO: short version of:
// C:\Users\u\AppData\Local\Packages\ceno_5e75r73jvfq74\LocalCache\Roaming\eQualitie\Ceno Alpha

NS_IMETHODIMP
OuinetNativeHelpers::GetRealAppData(const nsAString &virtualAppData, nsAString &realAppData) {
  const auto familyName = getPackageFamilyName();
  if (!familyName.has_value()) {
    GetShortPath(virtualAppData, realAppData);
    return NS_OK;
  }

  const auto roamingAppData = getRoamingAppData();
  const auto localAppData = getLocalAppData();

  if (!roamingAppData.has_value() || !localAppData.has_value()) {
    GetShortPath(virtualAppData, realAppData);
    return NS_OK;
  }

  const std::wstring_view virtualAppDataStr{
    reinterpret_cast<const wchar_t *>(virtualAppData.BeginReading()),
    virtualAppData.Length()
  };

  if (!virtualAppDataStr.starts_with(roamingAppData.value())) {
    GetShortPath(virtualAppData, realAppData);
    return NS_OK;
  }

  std::wstring_view suffixInRoaming{virtualAppDataStr};
  suffixInRoaming.remove_prefix(roamingAppData.value().length());
  while (suffixInRoaming.starts_with(L'/') || suffixInRoaming.starts_with(L'\\')) {
    suffixInRoaming.remove_prefix(1);
  }

  const std::wstring realPath = std::format(
    L"{}\\Packages\\{}\\LocalCache\\Roaming\\{}",
    localAppData.value(),
    familyName.value(),
    suffixInRoaming
  );

  const std::wstring shortPath = getShortPath(realPath);
  realAppData.Assign(shortPath.c_str(), shortPath.length());
  return NS_OK;
}

} // namespace: mozilla
