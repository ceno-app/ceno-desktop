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
    std::wstring familyName;
    familyName.resize(nameLen, L'\0');

    rc = GetCurrentPackageFamilyName(&nameLen, familyName.data());
    if (rc != ERROR_SUCCESS) {
        return {};
    }
    // remove trailing null terminator. wstring already handles it.
    familyName.resize(nameLen - 1);
    return familyName;
}

static std::optional<std::wstring> getLocalAppData() {
    wchar_t localAppData[MAX_PATH] { };
    DWORD localAppDataSize = MAX_PATH;

    if (ERROR_SUCCESS == RegGetValueW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
        L"Local AppData",
        RRF_RT_REG_EXPAND_SZ | RRF_RT_REG_SZ, NULL, localAppData, &localAppDataSize)) {
        return localAppData;
    }

    const auto envVarSize = GetEnvironmentVariableW(L"LOCALAPPDATA", localAppData, MAX_PATH);
    if (envVarSize > 0 && envVarSize < MAX_PATH) {
        return localAppData;
    }

    return {};
}

static std::optional<std::wstring> getRoamingAppData() {
    wchar_t roamingAppData[MAX_PATH] { };
    DWORD roamingAppDataSize = MAX_PATH;

    if (ERROR_SUCCESS == RegGetValueW(
        HKEY_CURRENT_USER,
        L"Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
        L"AppData",
        RRF_RT_REG_EXPAND_SZ | RRF_RT_REG_SZ, NULL, roamingAppData, &roamingAppDataSize)) {
        return roamingAppData;
    }

    const auto envVarSize = GetEnvironmentVariableW(L"APPDATA", roamingAppData, MAX_PATH);
    if (envVarSize > 0 && envVarSize < MAX_PATH) {
        return roamingAppData;
    }

    return {};
}

static std::wstring getShortPath(const std::wstring &longPath) {
  std::wstring shortPath = longPath;
  const auto shortenedLength = GetShortPathNameW(longPath.c_str(), shortPath.data(), shortPath.capacity());
  if (shortenedLength > 0) {
      shortPath.resize(shortenedLength);
  }
  return shortPath;
}

NS_IMETHODIMP
OuinetNativeHelpers::GetShortPath(const nsAString &longPath, nsAString &shortPath) {
  // nsAString may not be null terminated.
  const std::wstring longPathStr {
    reinterpret_cast<const wchar_t*>(longPath.BeginReading()),
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
// @TODO:
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

  const std::wstring_view virtualAppDataStr {
    reinterpret_cast<const wchar_t*>(virtualAppData.BeginReading()),
    virtualAppData.Length()
  };

  if (!virtualAppDataStr.starts_with(roamingAppData.value())) {
    GetShortPath(virtualAppData, realAppData);
    return NS_OK;
  }

  std::wstring_view suffixInRoaming { virtualAppDataStr };
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
