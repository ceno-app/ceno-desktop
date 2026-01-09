#pragma once

#include <filesystem>
#include <string_view>

#include <Windows.h>

class ProcessIdFile {
	constexpr static std::wstring_view g_pidFilename { L"ouinet.pid" };
	const std::filesystem::path pidFilePath;
	bool written { false };
public:
	explicit ProcessIdFile(const std::filesystem::path &repoPath) : pidFilePath(repoPath / g_pidFilename) {}
	~ProcessIdFile();

	bool write(DWORD windowProcessId);
	bool remove(std::error_code &ec);
	const std::filesystem::path & getPidFilePath() const;
};
