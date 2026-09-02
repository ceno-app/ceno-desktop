#include <algorithm>
#include <filesystem>
#include <utility>

#include <windows.h>

#include "paths.h"

std::wstring normalizePath(const wchar_t* raw) {
    if (!raw) return std::wstring{};

    std::wstring result;

    // Expand environment variables (%ProgramFiles%, %AppData%)
    // Success returns length INCLUDING null, failure returns required size INCLUDING null
    std::wstring expanded(MAX_PATH, L'\0');
    if (const DWORD length = ExpandEnvironmentStringsW(raw, expanded.data(), MAX_PATH); length == 0) {
        // Error, keep original
        result = raw;
    } else if (length <= MAX_PATH) {
        // Success - length includes null terminator
        expanded.resize(length - 1);
        result = std::move(expanded);
    } else if (length <= 32768) { // length is required buffer size (including null)
        expanded.resize(length - 1);
        if (ExpandEnvironmentStringsW(raw, expanded.data(), length) != 0) {
            expanded.resize(length - 1);
            result = std::move(expanded);
        }
    }

    // Get full path (resolve relative paths)
    // Success returns length EXCLUDING null, failure returns required size INCLUDING null
    std::wstring fullPath(MAX_PATH, L'\0');
    if (const DWORD length = GetFullPathNameW(result.c_str(), MAX_PATH, fullPath.data(), nullptr); length == 0) {
        // Error
    } else if (length < MAX_PATH) {
        // Success - length is length without null terminator
        fullPath.resize(length);
        result = std::move(fullPath);
    } else if (length <= 32767) { // length is required size including null
        fullPath.resize(length);
        const DWORD len2 = GetFullPathNameW(result.c_str(), length, fullPath.data(), nullptr);
        if (len2 != 0 && len2 < length) {
            fullPath.resize(len2);
            result = std::move(fullPath);
        }
    }

    // Get long path (resolve 8.3 short names like PROGRA~1)
    // Success returns length EXCLUDING null, failure returns required size INCLUDING null
    std::wstring longPath(MAX_PATH, L'\0');
    if (const DWORD length = GetLongPathNameW(result.c_str(), longPath.data(), MAX_PATH); length == 0) {
        // Error or file doesn't exist - keep current result
    } else if (length < MAX_PATH) {
        // Success - length is length without null terminator
        longPath.resize(length);
        result = std::move(longPath);
    } else if (length <= 32767) { // length is required size including null
        longPath.resize(length);
        DWORD len2 = GetLongPathNameW(result.c_str(), longPath.data(), length);
        if (len2 != 0 && len2 < length) {
            longPath.resize(len2);
            result = std::move(longPath);
        }
    }

    CharLowerW(result.data());

    return result;
}

std::optional<std::wstring> getMyPath() {
    // Get raw module path (might be 8.3 format like PROGRA~1)
    std::wstring rawPath;
    size_t size = MAX_PATH;
    constexpr size_t maxSize = 32767;

    while (size <= maxSize) {
        rawPath.resize(size);
        if (const DWORD written = GetModuleFileNameW(nullptr, rawPath.data(), size); 0 == written) {
            return {};
        } else if (written < size) {
            rawPath.resize(written);
            break;
        }
        size = std::min<size_t>(size * 2, maxSize);
    }
    if (rawPath.empty()) return {};

    return normalizePath(rawPath.c_str());
}

std::wstring getNetworkClientPath(const wchar_t *myPath) {
    std::filesystem::path networkClientPath {myPath};
    networkClientPath.replace_filename(L"ceno-network-client.exe");
    return networkClientPath.wstring();
}

