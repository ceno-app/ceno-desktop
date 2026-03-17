#include <windows.h>
#include <psapi.h>
#include <shlwapi.h>

#include <iostream>
#include <filesystem>
#include <string>

constexpr const wchar_t *expectedFilename = L"ceno-network-client.exe";

bool CheckProcessImageName(HANDLE myHandle) {
    std::wstring path(MAX_PATH, L'\0');
    DWORD size = MAX_PATH;
    if (!QueryFullProcessImageNameW(myHandle, 0, path.data(), &size)) {
        if (ERROR_INSUFFICIENT_BUFFER != GetLastError()) {
            return false;
        }
        constexpr DWORD NT_MAX_PATH = 32767;
        path.resize(NT_MAX_PATH);
        size = NT_MAX_PATH;
        if (!QueryFullProcessImageNameW(myHandle, 0, path.data(), &size)) {
            return false;
        }
    }
    path.resize(wcsnlen(path.c_str(), path.size()));
    return _wcsicmp(std::filesystem::path{path}.filename().c_str(), expectedFilename) == 0;
}

int wmain(const int argc, const wchar_t *argv[]) {
    if (argc != 2) {
        std::wcerr << "Program usage:" << std::endl
            << "\"ceno-network-client-terminator.exe pid - to terminate a stuck Ceno Network Client process" << std::endl;
        return 1;
    }

    int retval = 0;

    const DWORD pid = static_cast<DWORD>(std::wcstol(argv[1], nullptr, 10));

    HANDLE h = ::OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_TERMINATE, FALSE, pid);
    if (h) {
        if (!CheckProcessImageName(h) ||
            0 == ::TerminateProcess(h, 1)
        ) {
            retval = 1;
        }
        ::CloseHandle(h);
    }
    return retval;
}
