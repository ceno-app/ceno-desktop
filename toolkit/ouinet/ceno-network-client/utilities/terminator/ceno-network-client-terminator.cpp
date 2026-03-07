#include <iostream>

#include "../ceno-network-client-helper.h"

// EnumWindowsCallback Source:
// https://stackoverflow.com/questions/11711417/get-hwnd-by-process-id-c/20730976#20730976
// Posted by Andre Kirpitch
// Retrieved 2026-01-05, License - CC BY-SA 3.0
static HWND g_networkClientWindowHandle = NULL;
BOOL CALLBACK EnumWindowsCallback(HWND hwnd, const LPARAM processId) {
    DWORD windowProcessId;
    GetWindowThreadProcessId(hwnd, &windowProcessId);

    if (processId == windowProcessId) {
        g_networkClientWindowHandle = hwnd;
        return FALSE;
    }
    return TRUE;
}

int wmain(const int argc, const wchar_t *argv[]) {
    if (argc != 2) {
        std::wcerr << "Program usage:" << std::endl
            << "\"ceno-network-client-terminator.exe c:\\ouinet-repo\" to terminate an active Ceno Network Client process" << std::endl;
        return 1;
    }

    const std::filesystem::path ouinetRepoPath = argv[1];
    const auto processId = getProcessId(ouinetRepoPath);
    if (!processId.has_value()) {
        return 1;
    }

    EnumWindows(EnumWindowsCallback, processId.value());
    if (NULL == g_networkClientWindowHandle) {
        std::wcerr << L"Failed to find Ceno Network Client window: " << GetLastErrorAsWString() << std::endl;
        return 1;
    }

    HANDLE handle = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId.value());
    if (handle == NULL) {
        std::wcerr << L"Failed to get process handle. Will not be able to wait for termination to complete: " << GetLastErrorAsWString() << std::endl;
    }

    if (!PostMessage(g_networkClientWindowHandle, WM_CLOSE, 0, 0)) {
        std::wcerr << L"Failed to end Ceno Network Client" << std::endl;
        return 1;
    }
    std::wcout << L"Request to terminate process sent" << std::endl;

    if (handle == NULL) {
        return 1;
    }

    std::wcout << L"Waiting for process to finish" << std::endl;
    if (WAIT_OBJECT_0 != WaitForSingleObject(handle, INFINITE)) {
        std::wcerr << L"Failed to wait for process: " << GetLastErrorAsWString() << std::endl;
        return 1;
    }

    DWORD exitCode;
    if (0 == GetExitCodeProcess(handle, &exitCode)) {
        std::wcerr << L"Failed to get process exit value: " << GetLastErrorAsWString() << std::endl;
        return 1;
    }

    return exitCode;
}
