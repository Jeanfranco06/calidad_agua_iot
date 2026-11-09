#include "ntp_helper.h"
#include "config.h"

static bool ntp_started = false;

void initNtp() {
    if (!ntp_started) {
        configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, NTP_SERVER_1, NTP_SERVER_2);
        ntp_started = true;
        Serial.println("[NTP] Cliente SNTP configurado e iniciado.");
    }
}

bool isNtpSynced() {
    time_t now = time(nullptr);
    // 1704067200 corresponde al 1 de enero de 2024
    return (now > 1704067200);
}

unsigned long getUnixEpoch() {
    time_t now = time(nullptr);
    if (now > 1704067200) {
        return (unsigned long)now;
    }
    // Fallback relativo si no se ha recibido respuesta NTP aún
    return (unsigned long)(millis() / 1000);
}
