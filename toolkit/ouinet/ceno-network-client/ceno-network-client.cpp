#include <optional>
#include <string>

#include <windows.h>
#include <shellapi.h>

#include "ArgumentsConverter.h"
#include "ErrorUtils.h"
#include "GuiWindow.h"
#include "ProcessIdFile.h"

std::atomic_int g_exitCode = EXIT_FAILURE;
std::atomic_flag g_ouinetIsStuckOnExit_ForceExitInMain;

int APIENTRY wWinMain(HINSTANCE hInstance, HINSTANCE, LPWSTR ouinetClientArguments, int /*nCmdShow*/) {
    ArgvConverter arguments{ouinetClientArguments};

    if (!arguments.repo_path.has_value()) {
        ShowError(L"--repo argument not found!", L"");
        return 1;
    }

    ProcessIdFile pidFile(arguments.repo_path.value());

    if (!arguments.ceno_network_client_path.has_value()) {
        ShowError(L"Failed to find Ceno Browser executable.", L"");
        return 1;
    }

    if (NULL == createGuiWindow(hInstance, &arguments, &pidFile))
        return 1;

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    if (g_ouinetIsStuckOnExit_ForceExitInMain.test())
        exit(EXIT_FAILURE);
    return g_exitCode;
}
