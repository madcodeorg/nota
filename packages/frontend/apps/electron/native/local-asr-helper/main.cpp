// Nota's private stdio adapter. Models stay loaded across phrase requests.
// Input: little-endian uint32 sample count, uint16 language byte count,
// UTF-8 language, then signed PCM16 samples at 16 kHz mono. Output: JSON lines.
#include <algorithm>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif
#ifdef NOTA_WHISTLE
#include "needle.h"
#else
#include "whisper.h"
#endif

static std::string quote(const std::string &s) {
    std::string out = "\"";
    const char *hex = "0123456789abcdef";
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (c < 32) { out += "\\u00"; out += hex[c >> 4]; out += hex[c & 15]; }
        else out += c;
    }
    return out + '"';
}
static void fail(const std::string &message) {
    std::cout << "{\"error\":" << quote(message) << "}" << std::endl;
}
static bool read_exact(char *out, size_t count) {
    return bool(std::cin.read(out, std::streamsize(count)));
}
int main(int argc, char **argv) {
#ifdef _WIN32
    _setmode(_fileno(stdin), _O_BINARY);
#endif
    if (argc != 2) { fail("Expected a model path."); return 1; }
#ifdef NOTA_WHISTLE
    std::ifstream file(argv[1], std::ios::binary | std::ios::ate);
    if (!file || file.tellg() <= 0 || file.tellg() > 64 * 1024 * 1024) {
        fail("Whistle model is missing or invalid."); return 1;
    }
    std::vector<unsigned char> model(static_cast<size_t>(file.tellg()));
    file.seekg(0);
    if (!file.read(reinterpret_cast<char *>(model.data()), model.size()) ||
        needle_load(model.data(), model.size()) < 0) {
        fail(needle_last_error()); return 1;
    }
#else
    auto params = whisper_context_default_params();
    params.use_gpu = false; // Predictable CPU memory; no second GPU copy.
    auto *ctx = whisper_init_from_file_with_params(argv[1], params);
    if (!ctx) { fail("Whisper model could not load."); return 1; }
#endif
    std::cout << "{\"ready\":true}" << std::endl;
    unsigned char header[6];
    while (read_exact(reinterpret_cast<char *>(header), sizeof(header))) {
        uint32_t count = uint32_t(header[0]) | (uint32_t(header[1]) << 8) |
                         (uint32_t(header[2]) << 16) | (uint32_t(header[3]) << 24);
        uint16_t lang_size = uint16_t(header[4]) | (uint16_t(header[5]) << 8);
        if (!count || count > 30 * 16000 || lang_size > 32) {
            fail("Invalid audio request; maximum phrase is 30 seconds."); break;
        }
        std::string language(lang_size, '\0');
        std::vector<unsigned char> raw(count * 2);
        if (!read_exact(language.data(), lang_size) ||
            !read_exact(reinterpret_cast<char *>(raw.data()), raw.size())) break;
        std::vector<float> pcm(count);
        for (uint32_t i = 0; i < count; ++i) {
            int16_t s = static_cast<int16_t>(uint16_t(raw[i * 2]) | (uint16_t(raw[i * 2 + 1]) << 8));
            pcm[i] = float(s) / 32768.0f;
        }
#ifdef NOTA_WHISTLE
        std::vector<char> result(1024 * 1024);
        if (needle_transcribe(pcm.data(), int(count),
                language == "auto" ? nullptr : language.c_str(), nullptr, 0,
                result.data(), int(result.size())) < 0) fail(needle_last_error());
        else std::cout << result.data() << std::endl;
#else
        auto options = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
        options.n_threads = std::max(1u, std::min(4u, std::thread::hardware_concurrency()));
        options.language = language.c_str();
        // "auto" detects then transcribes; detect_language=true returns early.
        options.detect_language = false;
        options.translate = false;
        options.no_context = true;
        options.print_progress = false;
        options.print_realtime = false;
        options.print_timestamps = false;
        options.print_special = false;
        if (whisper_full(ctx, options, pcm.data(), int(count)) != 0) {
            fail("Whisper transcription failed."); continue;
        }
        std::string text;
        for (int i = 0; i < whisper_full_n_segments(ctx); ++i)
            text += whisper_full_get_segment_text(ctx, i);
        const char *lang = whisper_lang_str(whisper_full_lang_id(ctx));
        std::cout << "{\"text\":" << quote(text) << ",\"language\":"
                  << (lang ? quote(lang) : "null") << "}" << std::endl;
#endif
    }
#ifndef NOTA_WHISTLE
    whisper_free(ctx);
#endif
    return 0;
}
