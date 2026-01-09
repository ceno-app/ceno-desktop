#pragma once

#include <filesystem>
#include <fstream>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>

// for DWORD
#include <windows.h>

std::wstring GetLastErrorAsWString() {
        //Get the error message ID, if any.
    const DWORD errorMessageID = ::GetLastError();
    if (errorMessageID == 0) {
        //No error message has been recorded
        return {};
    }
    LPWSTR messageBuffer = nullptr;
    //Ask Win32 to give us the string version of that message ID.
    //The parameters we pass in, tell Win32 to create the buffer that holds the message for us (because we don't yet know how long the message string will be).
    const size_t size = FormatMessage(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, errorMessageID, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPWSTR)&messageBuffer, 0, nullptr);

    std::wstring message(messageBuffer, size);
    LocalFree(messageBuffer);
    return message;
}

std::optional<DWORD> getProcessId(const std::filesystem::path &ouinetRepoPath) {
    // const std::filesystem::path repoPath { ouinetRepo };
    static constexpr std::wstring_view g_pidFilename = L"ouinet.pid";
    const std::filesystem::path pidFilePath = ouinetRepoPath / g_pidFilename;

    const std::filesystem::file_status status = std::filesystem::status(pidFilePath);
    if (!std::filesystem::exists(status) || !std::filesystem::is_regular_file(status)) {
        std::wcerr << L"Process ID file not found: " << pidFilePath << std::endl;
        return {};
    }

    std::ifstream fstream { pidFilePath };
    if (!fstream.good()) {
        std::wcerr << L"Failed to read process ID file: " << pidFilePath << std::endl;
        return {};
    }

    std::stringstream buffer;
    buffer << fstream.rdbuf();

    DWORD processId = 0;
    if (!(buffer >> processId)) {
        std::wcerr << L"Failed to parse process ID file: " << pidFilePath << std::endl;
        return {};
    }

    return processId;
}
