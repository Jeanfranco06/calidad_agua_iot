#ifndef NTP_HELPER_H
#define NTP_HELPER_H

#include <Arduino.h>
#include <time.h>

void initNtp();
bool isNtpSynced();
unsigned long getUnixEpoch();

#endif // NTP_HELPER_H
