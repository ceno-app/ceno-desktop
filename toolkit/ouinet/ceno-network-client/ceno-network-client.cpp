#include <format>
#include <optional>
#include <string>
#include <thread>

#include <windows.h>
#include <shellapi.h>

#include "ErrorUtils.h"
#include "GuiWindow.h"
#include "Ouinet.h"
#include "ProcessIdFile.h"

static int g_exitCode = EXIT_FAILURE;

static void onOuinetExit(const int exit_code) {
    g_exitCode = exit_code;
    requestWindowClose();
}

static std::optional<std::pair<std::filesystem::path, std::filesystem::path>> getExecutablePaths(HINSTANCE hInstance) {
    constexpr std::wstring_view g_cenoExecutableFilename{ L"ceno-alpha.exe" };
    constexpr std::wstring_view g_ouinetClientExecutableFilename{ L"client.exe" };

    WCHAR moduleFilepath[MAX_PATH];

    // C:\ceno-alpha\Ouinet\ceno-network-client.exe
    if (0 == GetModuleFileName(hInstance, moduleFilepath, MAX_PATH)) {
        return {};
    }

    return std::make_pair(
        // ceno.exe is one directory up from ceno-network-client.exe
        std::filesystem::path{ moduleFilepath }.parent_path().parent_path().append(g_cenoExecutableFilename),
        // Ouinet client.exe is in the same directory as ceno-network-client.exe
        std::filesystem::path{ moduleFilepath }.parent_path().append(g_ouinetClientExecutableFilename)
    );
}

std::optional<std::filesystem::path> getRepoPath(const LPCWSTR ouinetClientArguments) {
    struct LocalFreeRAII {
        LPWSTR* data;
        explicit LocalFreeRAII(LPWSTR* data) : data(data) {}
        ~LocalFreeRAII() {
            if (data != NULL) {
                LocalFree(data);
            }
        }
    };

    int argc = 0;
    const LocalFreeRAII argv { CommandLineToArgvW(ouinetClientArguments, &argc) };
    if (NULL == argv.data || argc < 2) {
        return {};
    }

    // argc - 1, because we are searching for --repo, which will be followed by value
    for (int i = 0; i < argc - 1; i++) {
        if (constexpr std::wstring_view repoArgument(L"--repo"); repoArgument == argv.data[i]) {
            return std::filesystem::path(argv.data[i + 1]);
        }
    }

    return {};
}

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR ouinetClientArguments, int /*nCmdShow*/) {
    const auto executablePaths = getExecutablePaths(hInstance);
    if (!executablePaths) {
        ShowError(L"Failed to find Ceno Browser executable.", L"");
        return 1;
    }

    const std::filesystem::path cenoExecutablePath = executablePaths->first;
    const std::filesystem::path ouinetClientPath = executablePaths->second;

    const auto repoPath = getRepoPath(ouinetClientArguments);
    if (!repoPath.has_value()) {
        ShowError(L"--repo argument not found!", L"");
        return 1;
    }

    HWND windowHandle = createGuiWindow(hInstance, cenoExecutablePath);
    if (NULL == windowHandle) {
        return 1;
    }

    DWORD windowProcessId = 0;
    GetWindowThreadProcessId(windowHandle, &windowProcessId);

    ProcessIdFile pidFile(repoPath.value());
    if (!pidFile.write(windowProcessId)) {
        ShowError(L"Failed to write Process ID file:", pidFile.getPidFilePath().wstring());

        removeNotificationIcon(windowHandle);
        return 1;
    }

    std::jthread ouinetThread { ouinet_client_run, ouinetClientPath, ouinetClientArguments, onOuinetExit };

    MSG msg;
    while (GetMessage(&msg, windowHandle, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    ouinetThread.join();

    if (std::error_code ec; !pidFile.remove(ec)) {
        ShowErrorA(
            "Failed to remove Process ID file: ",
            std::format("{} - {}", pidFile.getPidFilePath().string(), ec.message())
        );
        return 1;
    }
    return g_exitCode;
}
