#include <format>
#include <fstream>

#include "ErrorUtils.h"
#include "ProcessIdFile.h"

bool ProcessIdFile::write(const HWND hWnd) {
    DWORD windowProcessId = 0;
    GetWindowThreadProcessId(hWnd, &windowProcessId);

    std::ofstream stream { pidFilePath};
    written = stream.good() && (stream << windowProcessId);

    if (!written) {
        ShowError(L"Failed to write Process ID file: ", pidFilePath.wstring());
    }
    return written;
}
ProcessIdFile::~ProcessIdFile() {
    if (!written)
        return;

    if (std::error_code ec; !std::filesystem::remove(pidFilePath, ec)) {
        ShowErrorA(
            "Failed to remove Process ID file: ",
            std::format("{} - {}", pidFilePath.string(), ec.message())
        );
    }
}
