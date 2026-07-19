#include <windows.h>
#include <shellapi.h>

#include "ArgumentsConverter.h"

struct LocalFreeRAII {
    LPWSTR* data;
    explicit LocalFreeRAII(LPWSTR* data) : data(data) {}
    ~LocalFreeRAII() {
        if (data != NULL) {
            LocalFree(data);
        }
    }
};

static std::optional<std::filesystem::path> getCenoNetworkClientExecutablePath() {
    std::wstring moduleFilepathBuffer;
    DWORD bufferLength = MAX_PATH;
    while (true) {
        moduleFilepathBuffer.resize(bufferLength, L'\0');

        // Get C:\ceno-alpha\Ouinet\ceno-network-client.exe
        if (0 == GetModuleFileName(nullptr, moduleFilepathBuffer.data(), bufferLength))
            return {};

        // Support for long filenames
        if (GetLastError() == ERROR_INSUFFICIENT_BUFFER) {
            if (bufferLength == 32768)
                return {};
            bufferLength = 32768;
        } else {
            // trim the string
            moduleFilepathBuffer.resize(wcsnlen(moduleFilepathBuffer.c_str(), moduleFilepathBuffer.size()));
            break;
        }
    }

    return std::filesystem::path { moduleFilepathBuffer };
}


ArgvConverter::ArgvConverter(const wchar_t *wArgsStr) {
    ceno_network_client_path = getCenoNetworkClientExecutablePath();
    if (!ceno_network_client_path) {
        return;
    }

    const LocalFreeRAII wArgv { CommandLineToArgvW(wArgsStr, &argc) };
    if (NULL == wArgv.data) {
        return;
    }

    storage.reserve(argc + 1);
    argv.reserve(argc + 1);

    storage.push_back(ceno_network_client_path.value().string());
    argv.push_back(storage.back().c_str());

    for (int i = 0; i < argc; ++i) {
        const int length = WideCharToMultiByte(CP_UTF8, 0, wArgv.data[i], -1, nullptr, 0, nullptr, nullptr);

        // length includes null terminator
        std::string narrow(length - 1, '\0');
        WideCharToMultiByte(CP_UTF8, 0, wArgv.data[i], -1, narrow.data(), length, nullptr, nullptr);
        storage.push_back(std::move(narrow));
        argv.push_back(storage.back().c_str());

        if (constexpr std::string_view repoArgument("--repo");  i + 1 < argc && repoArgument == storage.back()) {
            repo_path = std::filesystem::path( wArgv.data[i+1]);
        }
    }
    argc++;

    // null terminate the argv array
    argv.push_back(nullptr);
}
