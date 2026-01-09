#include <atomic>
#include <filesystem>
#include <format>
#include <string>

#include <windows.h>

#include "Ouinet.h"
#include "ErrorUtils.h"

static std::atomic_flag ouinetIsRunning {};
// static std::atomic<DWORD> ouinetProcessId {};
static std::atomic<HANDLE> ouinetProcessHandle {};

// Main thread spawns a new thread and calls f, which blocks until ouinet client exits
void ouinet_client_run(const std::filesystem::path &ouinet_client_path, const wchar_t *arguments, void (*on_ouinet_exit)(int exit_code)) {
    STARTUPINFO startupInfo{
      .cb = sizeof(startupInfo),
    };
    PROCESS_INFORMATION ouinetProcessInfo;

    // prepend arguments string with the executable path
    std::wstring argumentsStr = std::format(L"{} {}", ouinet_client_path.wstring(), arguments);

    if (0 == CreateProcessW(
        ouinet_client_path.wstring().c_str(),
        argumentsStr.data(),
        NULL, NULL,
        FALSE,
        // @TODO:
        NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW,
        // NORMAL_PRIORITY_CLASS,
        NULL,
        NULL,
        &startupInfo,
        &ouinetProcessInfo
    )) {
        ShowError(L"Failed to create Ceno Network Client process:", GetLastErrorAsWString());
        on_ouinet_exit(1);
        return;
    }

    // ouinetProcessId = ouinetProcessInfo.dwProcessId;
    ouinetProcessHandle = ouinetProcessInfo.hProcess;

    // Check if the process does not exit in the first second
    WaitForSingleObject(ouinetProcessInfo.hProcess, 1000);
    DWORD exitCode = 1;
    auto rv = GetExitCodeProcess(ouinetProcessInfo.hProcess, &exitCode);
    // Failed to get exit code or exit code is not STILL_ACTIVE
    if (0 == rv || STILL_ACTIVE != exitCode) {
        if (0 == rv) {
            ShowError(L"Failed to create Ceno Network Client process", L"");
            exitCode = 1;
        }
        else {
            ShowError(L"Failed to create Ceno Network Client process. Exit code: ", std::format(L"{}", exitCode));
        }
        
        on_ouinet_exit((int)exitCode);
        return;
    }

    // Assuming that process did start successfully
    ouinetIsRunning.test_and_set();

    WaitForSingleObject(ouinetProcessInfo.hProcess, INFINITE);
    GetExitCodeProcess(ouinetProcessInfo.hProcess, &exitCode);
    ouinetIsRunning.clear();
    on_ouinet_exit((int)exitCode);
}

void ouinet_client_stop() {
    if (ouinetIsRunning.test()) {
        // @TODO: Attaching console to send CtrlC is not very reliable way to sigint
        // const auto pid = ouinetProcessId.load();
        // if (0 == AttachConsole(pid) || 0 == GenerateConsoleCtrlEvent(CTRL_C_EVENT, pid)) {
        TerminateProcess(ouinetProcessHandle.load(), 1);
        // }
    }
}
