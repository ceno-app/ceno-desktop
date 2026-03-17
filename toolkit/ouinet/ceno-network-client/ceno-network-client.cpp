#include <chrono>
#include <filesystem>
#include <optional>
#include <string>
#include <thread>

#include <windows.h>
#include <shellapi.h>
#include <shlwapi.h>

#include "ArgumentsConverter.h"
#include "ErrorUtils.h"
#include "GuiWindow.h"
#include "NetworkAddressMonitor.h"
#include "NetworkStatusMonitor.h"

std::atomic_int g_exitCode = EXIT_FAILURE;
std::atomic_flag g_ouinetIsStuckOnExit_ForceExitInMain;

static std::optional<std::filesystem::path> getTerminatorPath(HANDLE myHandle) {
    std::wstring path(MAX_PATH, L'\0');
    DWORD size = MAX_PATH;
    if (!QueryFullProcessImageNameW(myHandle, 0, path.data(), &size)) {
        if (ERROR_INSUFFICIENT_BUFFER != GetLastError()) {
            return std::nullopt;
        }
        constexpr DWORD NT_MAX_PATH = 32767;
        path.resize(NT_MAX_PATH);
        size = NT_MAX_PATH;
        if (!QueryFullProcessImageNameW(myHandle, 0, path.data(), &size)) {
            return std::nullopt;
        }
    }
    path.resize(wcsnlen(path.c_str(), path.size()));

    return std::filesystem::path(path).replace_filename(L"ceno-network-client-terminator.exe");
}

static void forceCloseThisProgram() {
    const DWORD myPid = GetCurrentProcessId();

    HANDLE myHandle = ::OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_TERMINATE, FALSE, myPid);
    if (myHandle == NULL || myHandle == INVALID_HANDLE_VALUE) {
        exit(EXIT_FAILURE);
    }

    if (const auto terminatorPath = getTerminatorPath(myHandle); terminatorPath.has_value()) {
        ::CloseHandle(myHandle);

        const std::wstring args = std::format(L"{}", myPid);
        SHELLEXECUTEINFOW sei = {
            .cbSize     = sizeof(sei),
            .fMask      = 0,
            .lpVerb     = L"open",
            .lpFile       = terminatorPath->c_str(),
            .lpParameters = args.c_str(),
            .nShow      = SW_HIDE,
        };

        if (!::ShellExecuteExW(&sei)) {
            myHandle = ::OpenProcess(PROCESS_TERMINATE, FALSE, myPid);
            ::TerminateProcess(myHandle, 1);
        }

        // Give 5 seconds for terminator to do the job
        std::this_thread::sleep_for(std::chrono::seconds(5));
    }
    ::TerminateProcess(myHandle, 1);
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR ouinetClientArguments, int /*nCmdShow*/) {
    ArgvConverter arguments{ouinetClientArguments};

    if (!arguments.ceno_network_client_path.has_value()) {
        ShowError(L"Failed to find Ceno Browser executable.", L"");
        return 1;
    }

    startNetworkStatusMonitor();
    startNetworkAddressMonitor();

    if (NULL == createGuiWindow(hInstance, &arguments))
        return 1;

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    stopNetworkStatusMonitor();
    stopNetworkAddressMonitor();

    if (g_ouinetIsStuckOnExit_ForceExitInMain.test()) {
        forceCloseThisProgram();
    }
    return g_exitCode;
}
