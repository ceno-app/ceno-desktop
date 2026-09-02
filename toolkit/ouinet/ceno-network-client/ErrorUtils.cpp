#include <format>

#include <windows.h>

#include "ErrorUtils.h"


// Returns the last Win32 error, in string format. Returns an empty string if there is no error.
// GetLastErrorAsString taken from:
// https://stackoverflow.com/questions/1387064/how-to-get-the-error-message-from-the-error-code-returned-by-getlasterror/17387176#17387176
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

std::string GetLastErrorAsAString() {
    //Get the error message ID, if any.
    const DWORD errorMessageID = ::GetLastError();
    if (errorMessageID == 0) {
        //No error message has been recorded
        return {};
    }
    LPSTR messageBuffer = nullptr;
    //Ask Win32 to give us the string version of that message ID.
    //The parameters we pass in, tell Win32 to create the buffer that holds the message for us (because we don't yet know how long the message string will be).
    const size_t size = FormatMessageA(
        FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
        nullptr, errorMessageID, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), (LPSTR)&messageBuffer, 0, nullptr);

    std::string message(messageBuffer, size);
    LocalFree(messageBuffer);
    return message;
}

void ShowError(const std::wstring_view err_prefix, const std::wstring_view err_msg) {
    MessageBoxW(NULL, std::format(L"{} {}", err_prefix, err_msg).c_str(), L"Ceno Network Client", MB_OK | MB_ICONERROR);
}

void ShowErrorA(const std::string_view err_prefix, const std::string_view err_msg) {
    MessageBoxA(NULL, std::format("{} {}", err_prefix, err_msg).c_str(), "Ceno Network Client", MB_OK | MB_ICONERROR);
}
