#include <iostream>

#include "../ceno-network-client-helper.h"

int wmain(const int argc, const wchar_t *argv[]) {
    if (argc != 2) {
        std::wcerr << "Program usage:" << std::endl
            << "\"ceno-network-client-monitor.exe c:\\ouinet-repo\" to block until Ceno Network Client process finishes" << std::endl;
        return 1;
    }

    const std::filesystem::path ouinetRepoPath = argv[1];
    const auto processId = getProcessId(ouinetRepoPath);
    if (!processId.has_value()) {
        return 1;
    }

    HANDLE handle = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId.value());
    if (handle == NULL) {
        std::wcerr << L"Failed to get process handle: " << GetLastErrorAsWString() << std::endl;
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

    return 1;
}
