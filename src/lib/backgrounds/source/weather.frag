/*{
  "DESCRIPTION": "Weather: Sky's sea of clouds in the weather you choose, or the live weather in your city, lit for the time of day: clear, partly cloudy or cloudy, windy, drizzle, showers, rain and downpours, thunderstorms and hail, snow, sleet and blizzards, fog, haze and smoke, hurricanes and tornadoes, frost on the glass in the cold and shimmer in the heat, and at night the stars and the moon in its real phase. On Automatic it follows the real sky there: how much cloud, how hard it rains or snows, which way and how strongly the wind blows, and, in the United States, the National Weather Service's tornado and hurricane warnings. A key press does something in the weather there: a cloud puffs up, raindrops splash on the glass, snow gusts out, the fog parts, lightning strikes, or at night a shooting star falls. Weather data by Open-Meteo.com (CC BY 4.0). Clouds after Vanta's (MIT, Teng Bao) and Inigo Quilez's; the moon photographed by NASA's Goddard Space Flight Center.",
  "INPUTS": [
    { "NAME": "place", "TYPE": "place", "LABEL": "City" },
    { "NAME": "weather", "TYPE": "long", "LABEL": "Weather", "DEFAULT": 0, "VALUES": [-1, 0, 8, 1, 14, 9, 11, 2, 10, 3, 6, 13, 4, 12, 7, 5, 15, 16, 17], "LABELS": ["Automatic", "Clear", "Partly cloudy", "Cloudy", "Windy", "Drizzle", "Showers", "Rain", "Heavy rain", "Thunderstorm", "Lightning", "Hail", "Snow", "Sleet", "Blizzard", "Fog", "Haze", "Hurricane", "Tornado"] },
    { "NAME": "time", "TYPE": "long", "LABEL": "Time of day", "DEFAULT": -1, "VALUES": [-1, 0, 1, 2, 3], "LABELS": ["Automatic", "Morning", "Afternoon", "Sunset", "Night"] },
    { "NAME": "speed", "TYPE": "float", "LABEL": "Wind", "DEFAULT": 0.8, "MIN": 0.2, "MAX": 3 },
    { "NAME": "temperature", "TYPE": "long", "LABEL": "Frost and heat", "DEFAULT": -1, "VALUES": [-1, 0, 1, 2], "LABELS": ["Automatic", "Off", "Frost", "Heat shimmer"] }
  ],
  "IMPORTED": { "moon": { "PATH": "ectodeck-asset:weather/moon.webp" } },
  "PASSES": [
    { "TARGET": "state", "PERSISTENT": true, "FLOAT": true, "WIDTH": "$WIDTH/80", "HEIGHT": "$HEIGHT/80" },
    { "TARGET": "clouds", "FLOAT": true, "WIDTH": "$WIDTH/3", "HEIGHT": "$HEIGHT/3" },
    {}
  ]
}*/

// Ectodeck's built-in Weather, drawn by the deck's own renderer. It is the
// Weather page moved off the browser, the same picture and the same logic:
//
//  1. state: a few pixels that remember, from frame to frame, what is shown,
//     what it is changing from and since when (each change eases in over
//     three seconds), and the clouds' clock; and work out where the sun and
//     moon are and where the camera looks.
//  2. clouds: Sky's sea of clouds (Vanta's clouds, after Inigo Quilez's),
//     taught a gradient sky, a sun of its own, air that can be clear, and a
//     view from under the cloud; drawn at a third of the size, which keeps
//     them soft. Between two views both are drawn, one dissolving into the other.
//  3. the picture: the clouds scaled up smoothly, and the weather drawn over
//     them at full size: the sun and moon, stars, rain, snow, fog, lightning
//     and what a key press does.

#define PI 3.14159265
#define RAD 0.0174532925

// ---- the state's layout: each value a float, four to a pixel
// the colours, three floats each
const int SKY_TOP = 0, SKY = 3, HORIZON = 6, GLOW = 9, CLOUD = 12, SHADOW = 15, SUN = 18, GLARE = 21, SUNLIGHT = 24;
// and the numbers
const int SUN_HEIGHT = 27, CLEARING = 28, LOOK_AT = 29, FLIP = 30, LIFT = 31, STRETCH = 32, SWING = 33, PACE = 34;
const int A_CLEAR = 35, A_CLOUDY = 36, A_RAIN = 37, A_SNOW = 38, A_BLIZZARD = 39, A_STORM = 40, A_FOG = 41, NIGHT = 42, DUSK = 43;
const int SUN_X = 44, SUN_Y = 45, MOON_X = 46, MOON_Y = 47, MOON_UP = 48, MOMENT = 49;
const int A_PARTLY = 50, A_DRIZZLE = 51, A_HEAVY = 52, A_SHOWERS = 53, A_SLEET = 54, A_HAIL = 55, A_WINDY = 56, A_HAZE = 57, A_HURRICANE = 58, A_TORNADO = 59;
// the wind across the screen (-1 leftward to 1 rightward) and how strong it is,
// frost and heat shimmer on the glass, and how much of the haze is dust (not smoke)
const int WIND_X = 60, GUST = 61, FROST = 62, HEAT = 63, HAZE_DUST = 64, CLOUD_BASE = 65, SPIRAL = 66;
const int VALUES = 68;
// pixels: what is shown, what it is changing from, and the rest
const int SHOWN = 0, FROM = 17, META = 34, CLOCK = 35, PINNED = 36, LIGHT = 37, DRIFT = 40;

// the weathers
const int CLEAR = 0, CLOUDY = 1, RAIN = 2, THUNDER = 3, SNOW = 4, FOG = 5, LIGHTNING = 6, BLIZZARD = 7, PARTLY = 8, DRIZZLE = 9;
const int HEAVY = 10, SHOWERS = 11, SLEET = 12, HAIL = 13, WINDY = 14, HAZE = 15, HURRICANE = 16, TORNADO = 17, WEATHERS = 18;
// looking up into the open sky, rather than down on the cloud or up from under it
bool upView(int w) { return w == CLEAR || w == HAZE; }
// seen from above the cloud: dry weather, as weather maps and apps show it
bool aboveCloud(int w) { return w == CLOUDY || w == PARTLY || w == WINDY || w == HURRICANE; }
bool stormy(int w) { return w == THUNDER || w == LIGHTNING || w == HAIL || w == HURRICANE || w == TORNADO; }
bool snowy(int w) { return w == SNOW || w == BLIZZARD || w == SLEET; }

vec4 stateAt(int i) {
    ivec2 size = textureSize(state, 0);
    return texelFetch(state, ivec2(i % size.x, i / size.x), 0);
}
float stored(int i) { return stateAt(i / 4)[i % 4]; }

// ---- the weather now: the one chosen, or on Automatic the city's. A US
// tornado warning shows a tornado; a hurricane warning with the wind at
// tropical storm strength (62 km/h), or hurricane-force wind anywhere (119
// km/h), a hurricane. Otherwise Open-Meteo's weather code: snow in a wind of
// 56 km/h (35 mph) is a blizzard, as the National Weather Service counts
// one; dry skies are clear, partly cloudy or cloudy by how much cloud there
// is, or hazy when the air is thick with smoke or dust, or windy in a strong
// breeze. Clear before the first report.
bool liveReport() { return weather < 0 && iWeather.x >= 0.0; }
int autoWeather() {
    if (iWeather.x < 0.0) return CLEAR;
    int c = int(iWeather.x);
    float gusts = iWeather.y, wind = iWeather3.y, alert = iAir.w;
    if (alert > 2.5) return TORNADO;
    if ((alert > 1.5 && gusts >= 62.0) || wind >= 119.0) return HURRICANE;
    if (c == 96 || c == 99) return HAIL;
    if (c >= 95) return THUNDER;
    if ((c >= 71 && c <= 77) || c == 85 || c == 86) return gusts >= 56.0 ? BLIZZARD : SNOW;
    if (c == 56 || c == 57 || c == 66 || c == 67) return SLEET;
    if (c >= 51 && c <= 55) return DRIZZLE;
    if (c == 61 || c == 63) return RAIN;
    if (c == 65 || c == 82) return HEAVY;
    if (c == 80 || c == 81) return SHOWERS;
    if (c == 45 || c == 48) return FOG;
    float cover = iWeather2.x >= 0.0 ? iWeather2.x : (c <= 1 ? 0.05 : c == 2 ? 0.4 : 0.9);
    bool hazy = iAir.x >= 0.0 && (iAir.z >= 0.5 || iAir.x >= 55.0 || iAir.y >= 100.0);
    if (hazy && cover < 0.7) return HAZE;
    if (wind >= 40.0 && cover < 0.85) return WINDY;
    if (cover < 0.15) return CLEAR;
    if (cover < 0.7) return PARTLY;
    return CLOUDY;
}
int chosenWeather() {
    if (weather < 0) return autoWeather();
    return ((weather % WEATHERS) + WEATHERS) % WEATHERS;
}

// ---- days since noon on 1 January 2000 (UTC), kept as a whole number of
// days and a fraction, so the sums stay exact in single floats
int dayNumber(int y, int m, int d) {
    int a = (14 - m) / 12, yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045;
}
void daysNow(out float whole, out float part) {
    whole = float(dayNumber(int(iDate.x), int(iDate.y) + 1, int(iDate.z)) - 2451545);
    part = -0.5 + (iDate.w - iTimezone) / 86400.0;
}
// where the deck is: the chosen city, or a guess from the time zone
vec2 here() {
    if (iPlace.w > 0.5 || iPlace.x != 0.0 || iPlace.y != 0.0) return iPlace.xy;
    return vec2(35.0, iTimezone / 240.0);
}

// Where the sun is in the sky: the standard sun position (the formula NOAA's
// calculator uses), and the moon along the same path, as far round from the
// sun as its phase. Seen facing the equator, the whole path, horizon to
// horizon, is spread across the width, and the height above the horizon up
// the screen, with the horizon at the bottom edge.
vec3 skyPlace(float whole, float part, float lat, float lon, float turn) {
    float g = (mod(357.529 + 0.98560028 * whole, 360.0) + 0.98560028 * part) * RAD;
    float q = mod(280.459 + 0.98564736 * whole, 360.0) + 0.98564736 * part;
    float L = (q + 1.915 * sin(g) + 0.020 * sin(2.0 * g) + turn * 360.0) * RAD;
    float e = (23.439 - 0.00000036 * (whole + part)) * RAD;
    float ra = atan(cos(e) * sin(L), cos(L)), dec = asin(sin(e) * sin(L));
    float hours = 18.697374558 + mod(0.06570982441908 * whole, 24.0) + 24.06570982441908 * part;
    float lst = mod(hours, 24.0) * 15.0 + lon;
    float ha = lst * RAD - ra, la = lat * RAD;
    float el = asin(sin(la) * sin(dec) + cos(la) * cos(dec) * cos(ha));
    float az = atan(-sin(ha), tan(dec) * cos(la) - sin(la) * cos(ha)) / RAD;
    float fromFront = mod((lat >= 0.0 ? az - 180.0 : az) + 540.0, 360.0) - 180.0;
    // the height eases toward the top of the view rather than stopping at it,
    // so a sun passing high overhead arcs over instead of running flat
    float y = el / RAD / 62.0;
    if (y > 0.66) y = 0.66 + 0.16 * (1.0 - exp(-(y - 0.66) / 0.16));
    return vec3(0.5 + 0.45 * clamp(fromFront / 115.0, -1.0, 1.0), y, el > 0.0 ? 1.0 : 0.0);
}
// the moon's phase today, 0 new to 0.5 full to 1 new again
float moonPhase() {
    float whole, part;
    daysNow(whole, part);
    return fract((whole - 5.2597) / 29.530588853 + part / 29.530588853);
}

// morning, afternoon, sunset or night, by the sun: the city's real sunrise
// and sunset once the weather report has brought them, an estimate until then
int clockTime() {
    if (iWeather.x >= 0.0) {
        float now = mod(iDate.w - iTimezone + iPlace.z, 86400.0), rise = iWeather.z, set = iWeather.w, noon = (rise + set) * 0.5;
        if (now < rise - 1800.0 || now >= set + 2700.0) return 3;
        if (now < noon - 3600.0) return 0;
        if (now >= set - 4500.0) return 2;
        return 1;
    }
    vec2 at = here();
    int y = int(iDate.x);
    float day = float(dayNumber(y, int(iDate.y) + 1, int(iDate.z)) - dayNumber(y, 1, 0));
    float lat = at.x * RAD, decl = -23.44 * RAD * cos(2.0 * PI / 365.0 * (day + 10.0));
    float cosH = (sin(-0.833 * RAD) - sin(lat) * sin(decl)) / (cos(lat) * cos(decl));
    float half_ = acos(clamp(cosH, -1.0, 1.0)) * 12.0 / PI;
    float noon = 12.0 + iTimezone / 3600.0 - at.y / 15.0, now = iDate.w / 3600.0;
    if (now < noon - half_ - 0.5 || now >= noon + half_ + 0.75) return 3;
    if (now < noon - 1.0) return 0;
    if (now >= noon + half_ - 1.25) return 2;
    return 1;
}
int chosenTime() { return time < 0 ? clockTime() : time % 4; }

// the sun and moon for the moment the sky shows: now, on Automatic; otherwise
// today at a time that stands for it, in the place's own time (morning at
// nine, afternoon at twenty to four, the sunset as the sun meets the
// horizon, night at half past ten)
void skyPositions(int T, out vec3 sun, out vec3 moon, out float moment) {
    vec2 at = here();
    float whole, part;
    daysNow(whole, part);
    if (time >= 0) {
        float midnight = floor(part + 0.5 + at.y / 360.0) - 0.5 - at.y / 360.0;
        float h = T == 0 ? 9.0 : T == 1 ? 15.0 + 40.0 / 60.0 : T == 3 ? 22.5 : 19.0;
        if (T == 2) {
            for (int i = 0; i < 240; i++) {
                float hh = 14.0 + float(i) / 30.0;
                if (skyPlace(whole, midnight + hh / 24.0, at.x, at.y, 0.0).y < 0.035) { h = hh; break; }
            }
        }
        part = midnight + h / 24.0;
    }
    sun = skyPlace(whole, part, at.x, at.y, 0.0);
    moon = skyPlace(whole, part, at.x, at.y, moonPhase());
    moment = part;
}

// ---- the look of each weather at each time of day: its colours are the
// time's, greyed, darkened and cooled
vec3 hex(int h) { return vec3(float((h >> 16) & 255), float((h >> 8) & 255), float(h & 255)) / 255.0; }

void goals(out float g[VALUES]) {
    int W = chosenWeather(), T = chosenTime();
    vec3 c[9];
    float sunHeight;
    // each time of day, as Sky has it: the sky overhead, its colour, the
    // horizon, the glow round the sun, the clouds, their shadows, the sun,
    // its glare and its light
    if (T == 0) { c[0] = hex(0x3d7fd6); c[1] = hex(0x8fc4ee); c[2] = hex(0xdce9f5); c[3] = hex(0x9a8468); c[4] = hex(0xc6d8ee); c[5] = hex(0x5a7394); c[6] = hex(0xfff1d6); c[7] = hex(0xb08a66); c[8] = hex(0xffe8c0); sunHeight = 0.35; }
    else if (T == 1) { c[0] = hex(0x2463c8); c[1] = hex(0x5fa8e6); c[2] = hex(0xc4e2f6); c[3] = hex(0xfff0d0); c[4] = hex(0xadc1de); c[5] = hex(0x183550); c[6] = hex(0xfffaf0); c[7] = hex(0xffd9a0); c[8] = hex(0xffe7c0); sunHeight = 0.75; }
    else if (T == 2) { c[0] = hex(0x1d2a5e); c[1] = hex(0x8c5a92); c[2] = hex(0xff9148); c[3] = hex(0xb8703a); c[4] = hex(0xf0a888); c[5] = hex(0x3b2c5e); c[6] = hex(0xffe8a8); c[7] = hex(0xff7a3a); c[8] = hex(0xff9a58); sunHeight = 0.03; }
    else { c[0] = hex(0x0c1230); c[1] = hex(0x18204a); c[2] = hex(0x2a3566); c[3] = vec3(0.0); c[4] = hex(0x3a4a6a); c[5] = hex(0x05080f); c[6] = vec3(0.0); c[7] = vec3(0.0); c[8] = hex(0x9ab0e0); sunHeight = 0.5; }
    // for each weather: toward what grey, how far, and how dark
    vec3 to = vec3(0.0); float grey = 0.0, dark = 0.0;
    if (W == CLOUDY) { to = hex(0x9aa4b0); grey = 0.35; dark = 0.08; }
    else if (W == RAIN) { to = hex(0x5c6670); grey = 0.6; dark = 0.3; }
    else if (W == THUNDER || W == LIGHTNING) { to = hex(0x2a2f3c); grey = 0.72; dark = 0.55; }
    else if (W == SNOW || W == BLIZZARD) { to = hex(0xc4ccd8); grey = 0.55; dark = 0.05; }
    else if (W == FOG) { to = hex(0xb8bec6); grey = 0.7; dark = 0.1; }
    else if (W == PARTLY) { to = hex(0x9aa4b0); grey = 0.12; dark = 0.0; }
    else if (W == DRIZZLE) { to = hex(0x7c858f); grey = 0.5; dark = 0.18; }
    else if (W == HEAVY) { to = hex(0x3a424c); grey = 0.72; dark = 0.45; }
    else if (W == SHOWERS) { to = hex(0x76808c); grey = 0.35; dark = 0.12; }
    else if (W == SLEET) { to = hex(0x9aa4b2); grey = 0.6; dark = 0.18; }
    // a hailstorm's sky and a tornado's have the green cast they are known for
    else if (W == HAIL) { to = hex(0x2c3a38); grey = 0.72; dark = 0.5; }
    else if (W == WINDY) { to = hex(0x9aa4b0); grey = 0.22; dark = 0.04; }
    else if (W == HAZE) { to = hex(0xb8a58a); grey = 0.5; dark = 0.08; }
    // a hurricane seen from above: sunlit cloud tops, a little greyer than Cloudy's
    else if (W == HURRICANE) { to = hex(0xdfe4ea); grey = 0.35; dark = 0.0; }
    else if (W == TORNADO) { to = hex(0x2f3d35); grey = 0.76; dark = 0.5; }
    for (int k = 0; k < 9; k++) {
        vec3 x = grey > 0.0 ? mix(c[k], to, (k == 6 || k == 7) ? grey * 0.8 : grey) : c[k];
        c[k] = mix(x, vec3(0.0), dark * (T == 3 ? 0.4 : 1.0));
    }
    // snow whitens the clouds and their light; sleet half does; rain and storms grey them
    bool greyed = W == RAIN || W == DRIZZLE || W == HEAVY || W == SHOWERS || stormy(W);
    for (int k = 4; k < 9; k++) {
        if (k == 5) continue;
        if (W == SNOW || W == BLIZZARD) c[k] = mix(mix(c[k], hex(0xcbd3de), 0.6), vec3(0.0), 0.14);
        else if (W == SLEET) c[k] = mix(mix(c[k], hex(0xb0b8c4), 0.5), vec3(0.0), 0.2);
        else if (greyed && W != HURRICANE) c[k] = mix(mix(c[k], hex(0x8a929c), 0.4), vec3(0.0), W == HEAVY ? 0.45 : 0.35);
    }
    for (int k = 0; k < 9; k++) {
        // a snowy sunset is dusk, about half as far down as night and duskier
        if (snowy(W) && T == 2) c[k] = mix(mix(c[k], hex(0x3a2c48), 0.3), vec3(0.0), 0.2);
        // a snowy night is still night: the whitened colours taken most of the way down
        if (snowy(W) && T == 3) c[k] = mix(mix(c[k], hex(0x1a2238), 0.5), vec3(0.0), 0.35);
        if (stormy(W) && T == 3) c[k] = mix(mix(c[k], hex(0x1c2840), 0.5), vec3(0.0), 0.12);
    }
    // a sky seen upward keeps the horizon in view at sunset, for the sun to set on
    bool sunlitUp = W == CLEAR || W == PARTLY || W == WINDY || W == HAZE;
    if (sunlitUp && T == 2) { sunHeight = 0.045; c[2] = mix(hex(0xffa644), c[2], grey); c[1] = mix(hex(0xe8683a), c[1], grey); c[0] = mix(hex(0x4a3868), c[0], grey); c[3] = hex(0x8a4418); }
    // and a morning's sun is up in the sky, not on the edge of the view
    if (sunlitUp && T == 0) sunHeight = 0.6;
    // a day's sun and its halo are drawn over the clouds; Sky's own glow lies
    // in a band along the horizon and would stretch it sideways
    if ((upView(W) || W == PARTLY || W == WINDY) && T < 2) c[3] = vec3(0.0);
    for (int k = 0; k < 9; k++) { g[k * 3] = c[k].r; g[k * 3 + 1] = c[k].g; g[k * 3 + 2] = c[k].b; }
    g[SUN_HEIGHT] = sunHeight;
    // the live weather's measurements, where there is a report
    bool live = liveReport();
    float cover = iWeather2.x, rate = iWeather2.y + iWeather2.z, snowRate = iWeather3.x, seeing = iWeather3.z;
    // Clear and haze look up into the open sky; Cloudy looks down on the sea
    // of cloud; partly cloudy, windy and showers, rain, snow and storms are
    // seen from under their clouds, all from the same place there, so changing
    // between them only reshapes and recolours the cloud (it breaks up into
    // scattered cloud, thickens to overcast, lowers into storm); fog is inside
    // the cloud
    float clearing = 0.0, lookAt = -1.0, flip = -1.0, lift = 0.9, stretch = 1.0, swing = 1.0;
    if (upView(W)) { clearing = 5.0; lookAt = 3.35; flip = 1.0; lift = 0.0; swing = 0.0; }
    else if (W == CLOUDY) { flip = 1.0; lift = 0.0; }
    else if (W == FOG) { clearing = -1.2; flip = 1.0; lift = 0.0; }
    else if (W == RAIN || W == SLEET) clearing = -0.3;
    else if (W == SHOWERS) clearing = -0.05;
    else if (W == THUNDER || W == LIGHTNING || W == TORNADO) { clearing = -0.4; stretch = 0.68; }
    else if (W == HAIL) { clearing = -0.45; stretch = 0.68; }
    else if (W == SNOW) clearing = -0.2;
    else if (W == DRIZZLE) clearing = -0.12;
    else if (W == HEAVY) { clearing = -0.55; stretch = 0.85; }
    else if (W == HURRICANE) { clearing = -0.6; stretch = 0.7; }
    else clearing = -0.5;
    float base = -9.0, whirl = 0.0;
    // Partly cloudy and windy are Cloudy's view with the layer broken: the cloud
    // has a base, and its tops dip under it into gaps (on Automatic, as much
    // cloud as the sky has); windy's cloud races past
    if (W == PARTLY || W == WINDY) {
        flip = 1.0; lift = 0.0; lookAt = -1.0; base = -0.9;
        clearing = W == PARTLY ? 0.8 : 0.6;
        if (live && cover >= 0.0) clearing = mix(1.05, 0.45, smoothstep(0.15, 0.75, cover));
        if (W == WINDY) stretch = 0.8;
    }
    if (W == HURRICANE) { flip = 1.0; lift = 6.0; lookAt = -7.0; swing = 0.0; clearing = 0.45; whirl = 1.0; stretch = 1.0; base = -0.9; }
    g[CLEARING] = clearing; g[LOOK_AT] = lookAt; g[FLIP] = flip; g[LIFT] = lift; g[STRETCH] = stretch; g[SWING] = swing;
    g[CLOUD_BASE] = base; g[SPIRAL] = whirl;
    // how strong the wind is: the Wind setting, or on Automatic the real wind
    // (the setting then scales it); and which way it blows across the screen:
    // the view faces the equator, so screen right is west north of it
    float strength = speed;
    float windX = 1.0;
    if (live) {
        strength = clamp(iWeather3.y / 18.0, 0.4, 2.2) * speed / 0.8;
        float facing = here().x >= 0.0 ? 180.0 : 0.0;
        windX = cos((iWeather2.w + 180.0 - (facing + 90.0)) * RAD);
    }
    g[WIND_X] = windX; g[GUST] = strength;
    // how fast the clouds go (felt squared, as Sky's clock runs at it); seen
    // from under the cloud they are nearer, so they go slower
    float pace[18] = float[18](1.0, 1.0, 0.62, 0.55, 0.6, 1.0, 0.55, 1.25, 1.0, 0.55, 0.75, 0.8, 0.62, 0.6, 2.4, 0.5, 1.6, 0.9);
    g[PACE] = min(strength * pace[W], 3.2);
    // how much of each thing is in the air; on Automatic, as hard as it is
    // raining or snowing, as thick as the fog, the haze or the smoke
    float rainAmount = live ? clamp(0.65 + rate / 4.0, 0.65, 1.5) : 1.0;
    g[A_CLEAR] = W == CLEAR ? 1.0 : 0.0; g[A_CLOUDY] = W == CLOUDY ? 1.0 : 0.0;
    g[A_RAIN] = W == RAIN ? rainAmount : W == THUNDER ? 1.3 : W == SHOWERS ? 0.7 : W == HAIL ? 0.9 : W == TORNADO ? 0.8 : 0.0;
    g[A_SNOW] = W == SNOW ? (live ? clamp(0.35 + snowRate * 0.6, 0.35, 1.4) : 1.0) : 0.0;
    g[A_BLIZZARD] = W == BLIZZARD ? 1.0 : 0.0;
    g[A_STORM] = W == THUNDER || W == LIGHTNING ? 1.0 : W == HAIL ? 0.8 : W == HURRICANE ? 0.5 : W == TORNADO ? 0.9 : 0.0;
    g[A_FOG] = W == FOG ? (live ? clamp(1.25 - seeing * 0.18, 0.55, 1.25) : 1.0) : 0.0;
    g[A_PARTLY] = W == PARTLY ? 1.0 : 0.0;
    g[A_DRIZZLE] = W == DRIZZLE ? (live ? clamp(0.6 + rate * 1.5, 0.6, 1.3) : 1.0) : 0.0;
    g[A_HEAVY] = W == HEAVY ? (live ? clamp(0.8 + rate / 15.0, 0.8, 1.4) : 1.0) : 0.0;
    g[A_SHOWERS] = W == SHOWERS ? 1.0 : 0.0;
    g[A_SLEET] = W == SLEET ? 1.0 : 0.0;
    g[A_HAIL] = W == HAIL ? 1.0 : 0.0;
    g[A_WINDY] = W == WINDY ? 1.0 : 0.0;
    g[A_HAZE] = W == HAZE ? (live && iAir.x >= 0.0 ? clamp(max(max(iAir.z * 1.2, iAir.x / 80.0), iAir.y / 150.0), 0.35, 1.2) : 0.8) : 0.0;
    g[A_HURRICANE] = W == HURRICANE ? 1.0 : 0.0;
    g[A_TORNADO] = W == TORNADO ? 1.0 : 0.0;
    g[HAZE_DUST] = live && iAir.x >= 0.0 ? clamp(iAir.y / (iAir.y + iAir.x * 2.0 + 1e-3), 0.0, 1.0) : 0.2;
    g[NIGHT] = T == 3 ? 1.0 : 0.0; g[DUSK] = T == 2 ? 1.0 : 0.0;
    // frost on the glass in the cold, shimmer in the heat of the day
    float frost = 0.0, heat = 0.0;
    if (temperature < 0) {
        if (live) { frost = smoothstep(1.0, -8.0, iWeather3.w); heat = smoothstep(31.0, 38.0, iWeather3.w) * (T == 3 ? 0.0 : 1.0); }
    } else if (temperature == 1) frost = 0.8;
    else if (temperature == 2) heat = 0.8;
    g[FROST] = frost; g[HEAT] = heat;
    vec3 sun, moon;
    float moment;
    skyPositions(T, sun, moon, moment);
    g[SUN_X] = sun.x; g[SUN_Y] = sun.y; g[MOON_X] = moon.x; g[MOON_Y] = moon.y; g[MOON_UP] = moon.z;
    g[MOMENT] = moment; g[67] = 0.0;
}

// ---- Sky's camera, from its own sums: it looks from a point on a circle
// round the cloud, swinging slowly side to side (unless swing is 0), toward
// a height of lookAt; lift raises it
struct Camera { vec3 ro, side, up, w; };
Camera skyCamera(float lookAt, float lift, float swing, float clock) {
    float my = 0.5 * 0.33 + 0.28;
    float mx = 0.5 * 0.25 + mix(0.137, sin(clock * 0.1 + 3.1415) * 0.25 + 0.25, swing);
    vec3 ro = 4.0 * normalize(vec3(sin(3.0 * mx), 0.4 * my, cos(3.0 * mx)));
    ro.y += lift;
    vec3 w = normalize(vec3(0.0, lookAt, 0.0) - ro);
    vec3 side = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
    return Camera(ro, side, normalize(cross(side, w)), w);
}
// the direction in the sky of a place on a clear sky's screen
vec3 skyDirection(vec2 at) {
    Camera a = skyCamera(3.35, 0.0, 0.0, 0.0);
    float aspect = iResolution.x / iResolution.y;
    return normalize(((2.0 * at.x - 1.0) * aspect) * a.side + (2.0 * at.y - 1.0) * a.up + 1.5 * a.w);
}
// The sun and moon, placed on the screen of the open sky. As the camera tilts
// down onto the cloud they rise up the screen with the sky, into the band of
// sky over the cloud sea, keeping their height order: a high sun near the
// top, a setting sun on the cloud horizon. Seen from under the cloud they
// stay where the open sky shows them.
vec2 pinned(vec2 at, float lookAt, float lift, float swing, float flip, float clock) {
    float above = smoothstep(3.35, -1.0, lookAt) * step(0.0, flip);
    return vec2(at.x, mix(at.y, 0.7 + 0.15 * clamp(at.y / 0.82, 0.0, 1.0), above));
}

// ---- 1. the state
float ease(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
bool viewOf(int i) { return i >= CLEARING && i <= SWING; }

vec4 drawState(ivec2 px) {
    int id = px.x + px.y * int(RENDERSIZE.x);
    float g[VALUES];
    goals(g);
    int W = chosenWeather(), T = chosenTime();
    vec4 meta = stateAt(META), clockPx = stateAt(CLOCK);
    bool first = iFrame == 0;
    // a new weather or time of day: it eases in from what is shown now
    bool changed = first || int(meta.x) != W || int(meta.y) != T;
    float start = changed ? (first ? -10.0 : iTime) : meta.z;
    // a sky seen upward and Cloudy are one sky seen two ways, so the camera
    // tilts between them (the sun and moon pinned to the sky as it does); any
    // other new view is cross-faded in place, never flown to, and so is a new
    // cloud shape
    float dissolving = meta.w;
    if (changed && !first) {
        int was = int(meta.x);
        bool builds = (upView(was) || aboveCloud(was)) && (upView(W) || aboveCloud(W));
        bool moves = false;
        for (int i = LOOK_AT; i <= SWING; i++) if (abs(stored(SHOWN * 4 + i) - g[i]) > 1e-4) moves = true;
        if (abs(stored(SHOWN * 4 + STRETCH) - g[STRETCH]) > 1e-4) moves = true;
        dissolving = moves && !builds ? 1.0 : 0.0;
    }
    if (first) dissolving = 0.0;
    float raw = clamp((iTime - start) / 3.0, 0.0, 1.0), e = ease(raw);
    bool dissolveNow = dissolving > 0.5 && raw < 1.0;
    // every value: from what it was to where it is going
    float from[VALUES], shown[VALUES];
    for (int i = 0; i < VALUES; i++) {
        from[i] = first ? g[i] : changed ? stored(SHOWN * 4 + i) : stored(FROM * 4 + i);
        shown[i] = viewOf(i) && dissolveNow ? g[i] : mix(from[i], g[i], e);
        // once a change has eased in, the live weather's own changes (the cloud
        // thickening, the rain easing, the wind veering) drift in gently too
        if (!first && !changed && raw >= 1.0) {
            float was = stored(SHOWN * 4 + i);
            shown[i] = was + (g[i] - was) * min(1.0, iTimeDelta * 0.4);
        }
    }
    // a new time of day moves the moment the sky shows, so the sun and moon
    // travel their real path through the sky (up over noon from morning to
    // afternoon), rather than straight across the screen
    if (!first && abs(from[MOMENT] - g[MOMENT]) > 1e-6) {
        vec2 at = here();
        float whole, part;
        daysNow(whole, part);
        vec3 sun = skyPlace(whole, shown[MOMENT], at.x, at.y, 0.0), moon = skyPlace(whole, shown[MOMENT], at.x, at.y, moonPhase());
        shown[SUN_X] = sun.x; shown[SUN_Y] = sun.y; shown[MOON_X] = moon.x; shown[MOON_Y] = moon.y; shown[MOON_UP] = mix(from[MOON_UP], g[MOON_UP], e);
    }
    if (id < FROM) {
        int b = id * 4;
        return vec4(shown[b], shown[b + 1], shown[b + 2], shown[b + 3]);
    }
    if (id < META) {
        int b = (id - FROM) * 4;
        return vec4(from[b], from[b + 1], from[b + 2], from[b + 3]);
    }
    if (id == META) return vec4(float(W), float(T), start, dissolving);
    // Sky's clock: the clouds' pace (squared, as Sky's own clock ran at the
    // pace and moved the clouds by it again) added up over time, so changing
    // the pace never moves a cloud
    float clock = (first ? 0.0 : clockPx.x) + shown[PACE] * shown[PACE] * iTimeDelta;
    if (id == CLOCK) return vec4(clock, dissolveNow ? 1.0 : 0.0, e, 0.0);
    if (id == PINNED) {
        vec2 s = pinned(vec2(shown[SUN_X], shown[SUN_Y]), shown[LOOK_AT], shown[LIFT], shown[SWING], shown[FLIP], clock);
        vec2 m = pinned(vec2(shown[MOON_X], shown[MOON_Y]), shown[LOOK_AT], shown[LIFT], shown[SWING], shown[FLIP], clock);
        return vec4(s, m);
    }
    if (id == LIGHT) {
        // Sky's sun is where the sun (at night the moon) drawn in the sky is, so
        // there is one sun whichever way the camera looks, and it lights the clouds
        vec3 light = mix(skyDirection(vec2(shown[SUN_X], shown[SUN_Y])), skyDirection(vec2(shown[MOON_X], shown[MOON_Y])), shown[NIGHT]);
        light.y = max(light.y, 0.03);
        return vec4(normalize(light), 0.0);
    }
    // the view it is changing from, for a dissolve
    if (id == LIGHT + 1) return vec4(from[CLEARING], from[LOOK_AT], from[FLIP], from[LIFT]);
    if (id == LIGHT + 2) return vec4(from[STRETCH], from[SWING], 0.0, 0.0);
    // How far the wind has carried things, each added up over time so a
    // changing wind never moves anything backwards: across the screen (signed),
    // along it (always forward), and both again with the gusts in
    if (id == DRIFT) {
        vec4 d = first ? vec4(0.0) : stateAt(DRIFT);
        float gustShape = 0.75 + 0.25 * sin(0.6 * iTime) * sin(0.23 * iTime + 1.0), dt = iTimeDelta, gust = shown[GUST];
        return vec4(mod(d.x + shown[WIND_X] * gust * dt, 4096.0), mod(d.y + gust * dt, 4096.0), mod(d.z + gust * gustShape * dt, 4096.0), mod(d.w + shown[WIND_X] * gust * gustShape * dt, 4096.0));
    }
    return vec4(0.0);
}

// ---- 2. Sky's clouds
vec3 sundir;
float clearing, flip, stretch, lookAtNow, cloudCover, cloudBase, spiral, spin;
vec3 skyTopColor, skyColor, skyHorizonColor, skyGlowColor, cloudColor, cloudShadowColor, sunColor, sunGlareColor, sunlightColor;
float cloudClock;

float hash1(float p) { p = fract(p * 0.011); p *= (p + 7.5); p *= (p + p); return fract(p); }
float noise3(vec3 x) {
    vec3 p = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    float n = p.x + p.y * 57.0 + 113.0 * p.z;
    return mix(mix(mix(hash1(n + 0.0), hash1(n + 1.0), f.x), mix(hash1(n + 57.0), hash1(n + 58.0), f.x), f.y),
               mix(mix(hash1(n + 113.0), hash1(n + 114.0), f.x), mix(hash1(n + 170.0), hash1(n + 171.0), f.x), f.y), f.z);
}
const float constantTime = 1000.0;
// a hurricane's scale in the cloud's own units (its eye about a third of this across)
const float HURRICANE_SIZE = 3.0;
float mapCloud(vec3 p, int octaves) {
    vec3 speed1 = vec3(0.5, 0.01, 1.0) * 0.5;
    // A hurricane, as pictures from orbit show one: the whole cloud mass one
    // continuous spiral, solid round a small clear eye, and further out the
    // windings drawing apart so ocean opens between them, the arms thinning as
    // they unwind until they break up into the scattered cumulus beyond. Its top
    // is soft, the lumps only swirled by the turning. The whole storm turns
    // slowly, as one, so the spiral never winds up tighter
    float whirl = 0.0, smooth_ = 0.0, fine = 1.0, lumpy = 0.0;
    if (spiral > 0.001) {
        vec2 c = p.xz / HURRICANE_SIZE;
        c.y *= spin;
        float r = length(c);
        // turning counterclockwise seen from above north of the equator (clockwise
        // south); the inner cloud turned further than the outer, which swirls its lumps
        float a = spiral * (1.1 / (r + 0.5) + cloudClock * 0.05);
        vec2 d = mat2(cos(a), sin(a), -sin(a), cos(a)) * c;
        float theta = atan(c.y, c.x) - spiral * cloudClock * 0.05;
        float ragged = noise3(vec3(d * 2.5, 3.0)) + 0.5 * noise3(vec3(d * 6.0, 7.0));
        // the spiral: two arms of a log spiral, their gaps closed near the eye
        // and opening outward
        float arm = 0.5 + 0.5 * sin(2.0 * theta + 6.0 * log(r + 0.05) + 1.2 * ragged);
        float open_ = smoothstep(0.65, 1.7, r);
        float mass = 1.0 - smoothstep(0.9, 4.0, r + 0.4 * (ragged - 0.75));
        // (well out from the core the arms soften and broaden)
        float outer = smoothstep(1.0, 2.0, r);
        float cover = mass * mix(1.0, mix(smoothstep(0.3, 0.8, arm), arm, outer), open_);
        // and many thinner feeder bands, wound the same way, reaching far out
        float feeder = 0.5 + 0.5 * sin(5.0 * theta + 9.0 * log(r + 0.05) + 1.8 * ragged);
        float reach = 1.0 - smoothstep(1.1, 4.6, r + 0.5 * (ragged - 0.75));
        cover = max(cover, 0.95 * reach * open_ * feeder * feeder);
        // and between the bands, and out over the ocean beyond, streamers of cloud
        // peeling off the spiral: wound at its same pitch, so they run out from the
        // arms, broken up along their length and fading as they unwind
        float broken = noise3(vec3(d * 5.0, 5.0)) + 0.5 * noise3(vec3(d * 12.0, 9.0));
        float s1 = 0.5 + 0.5 * sin(6.0 * theta + 18.0 * log(r + 0.05) + 2.5 * ragged);
        float s2 = 0.5 + 0.5 * sin(10.0 * theta + 30.0 * log(r + 0.05) + 3.0 * broken);
        float streamers = (0.6 * s1 + 0.4 * s2) * (0.5 + 0.7 * broken);
        float around = 1.0 - smoothstep(2.5, 6.5, r);
        // (a lower, thinner layer than the bands, so the spiral still stands out over it)
        cover = max(cover, (0.42 + 0.12 * reach) * open_ * around * smoothstep(0.12, 0.6, streamers));
        float eyeR = 0.06 + 0.015 * clamp(p.y + 0.7, 0.0, 1.5);
        // (the cloud rises slowly from a thin veil to a layer, then thickens only
        // gently, so its edges thin out softly over the ocean rather than stop)
        // (and the bands further out are lower and thinner than the core)
        whirl = spiral * ((mix(-0.72, 0.05, smoothstep(0.0, 0.7, cover)) + 0.35 * cover) * (1.0 - 0.15 * outer) - 0.03 * outer
                        // (the spiral shows through the dense cloud as soft swells in its top)
                        + 0.3 * (feeder - 0.5) * smoothstep(0.4, 0.9, cover) * smoothstep(0.35, 0.95, r) - 4.0 * smoothstep(eyeR + 0.06, eyeR - 0.01, r));
        smooth_ = spiral * smoothstep(0.05, 0.6, cover) * smoothstep(eyeR + 0.04, eyeR + 0.14, r);
        vec2 dw = d * HURRICANE_SIZE; dw.y *= spin;
        p.xz = mix(p.xz, dw, spiral * smoothstep(0.08, 0.3, r));
        // a hurricane is vast: its cloud is fine-grained against it
        fine = mix(1.0, 3.0, spiral);
    }
    // (a hurricane's thin layer barely changes through its depth, which seen at a
    // slant would smear into streaks)
    vec3 q = p * vec3(stretch * fine, mix(1.0, 0.4, spiral), stretch * fine) - speed1 * (cloudClock * (1.0 - 0.9 * spiral) + constantTime);
    float f = 0.5 * noise3(q); q = q * 2.02;
    f += 0.25 * noise3(q); q = q * 2.03;
    if (octaves > 2) { f += 0.125 * noise3(q); q = q * 2.01; }
    if (octaves > 3) { f += 0.0625 * noise3(q); q = q * 2.02; }
    if (octaves > 4) f += 0.03125 * noise3(q);
    // the cirrus shield over the core is smooth, the lumps only faint under it
    f = mix(f, 0.5 + (f - 0.5) * 0.2, smooth_);
    // seen from this high the bands' towers are low against their spread (tall
    // lumps would lean out from the middle of the view in the perspective)
    f = 0.5 + (f - 0.5) * (1.0 - 0.45 * lumpy);
    // the cloud's base: below it there is no cloud, so where the tops dip under
    // it the layer breaks and the world beneath shows through the gaps
    float top = -0.5 + 1.75 * f - clearing + whirl;
    // (a hurricane's cloud is flat against its size: its tops rise half as far over the base)
    top = mix(top, cloudBase + (top - cloudBase) * 0.5, spiral);
    return clamp((top - p.y) * (1.0 + 1.5 * spiral), 0.0, 1.0) * smoothstep(cloudBase, cloudBase + 0.22, p.y);
}
vec4 integrate(vec4 sum, float dif, float den, vec3 bgcol, float t) {
    vec3 lin = cloudColor * 1.4 + sunlightColor * dif;
    // a hurricane's tops by moonlight, as the night satellite pictures show them
    lin += spiral * vec3(0.55, 0.62, 0.8) * clamp(1.0 - 2.0 * length(sunlightColor), 0.0, 1.0);
    vec4 col = vec4(mix(mix(vec3(1.0, 0.95, 0.8), vec3(0.86, 0.9, 0.98), step(flip, 0.0)), cloudShadowColor, den), den);
    col.xyz *= lin;
    col.xyz = mix(col.xyz, bgcol, 1.0 - exp(-0.003 * t * t));
    col.a *= 0.4;
    col.rgb *= col.a;
    return sum + col * (1.0 - sum.a);
}
vec4 raymarch(vec3 ro, vec3 rd, vec3 bgcol) {
    vec4 sum = vec4(0.0);
    float t = 0.0;
    // a camera high above the cloud starts its march at the top of the cloud,
    // not at the camera, and steps finely through it
    if (ro.y > 1.0 && rd.y < 0.0) t += (ro.y - 1.0) / -rd.y;
    float fineStep = 1.0 - 0.6 * spiral;
    // looking down on a hurricane, each pixel starts its march up to a whole step
    // further on, so the fixed steps leave no contour lines across its flat top
    if (spiral > 0.001) t += hash1(dot(gl_FragCoord.xy, vec2(1.0, 57.0))) * max(0.075, 0.02 * t) * fineStep * spiral;
    // four stretches, the nearer drawn in more detail
    for (int s = 0; s < 4; s++) {
        int steps = s == 0 ? 20 : s == 1 ? 25 : s == 2 ? 30 : 40, octaves = 5 - s;
        for (int i = 0; i < 40; i++) {
            if (i >= steps) break;
            vec3 pos = ro + t * rd;
            // (a camera above the cloud, looking down, starts out above it)
            if (pos.y < -3.0 || (pos.y > 2.0 && rd.y > 0.0) || sum.a > 0.99) break;
            float den = mapCloud(pos, octaves);
            if (den > 0.01) {
                float dif = clamp((den - mapCloud(pos + 0.3 * sundir, octaves)) / 0.6, 0.0, 1.0);
                sum = integrate(sum, dif, den, bgcol, t);
            }
            t += max(0.075, 0.02 * t) * fineStep;
        }
    }
    return clamp(sum, 0.0, 1.0);
}
vec3 skyRender(vec3 ro, vec3 rd) {
    float sun = clamp(dot(sundir, rd), 0.0, 1.0);
    float up = rd.y * flip;
    vec3 col = mix(skyHorizonColor, skyColor, smoothstep(-0.03, 0.22, up));
    col = mix(col, skyTopColor, smoothstep(0.2, 0.75, up));
    col = mix(col, skyHorizonColor * 0.6 + skyTopColor * 0.25, smoothstep(0.0, -0.45, up));
    // under a hurricane, far below, the dark ocean
    col = mix(col, vec3(0.04, 0.1, 0.19) * (0.4 + 0.6 * length(sunlightColor)), spiral * smoothstep(-0.05, -0.35, up));
    col += skyGlowColor * (0.3 * pow(sun, 16.0) + 0.14 * pow(sun, 4.0)) * (1.0 - smoothstep(0.0, 0.35, abs(up - sundir.y)));
    // Sky's own sun, over the cloud; looking up, the sun drawn in the sky is the sun
    // the sun is the one drawn in the sky over the cloud (Sky's own would be a second)
    float ownSun = 0.0;
    col += (0.3 * sunColor * pow(sun, 120.0) + 0.12 * sunGlareColor * pow(sun, 14.0)) * ownSun;
    vec4 res = raymarch(ro, rd, col);
    cloudCover = res.w;
    col = col * (1.0 - res.w) + res.xyz;
    col += (0.08 * sunGlareColor * pow(sun, 30.0) + (sunColor * 1.6 * smoothstep(0.99955, 0.9998, sun) + sunColor * 0.45 * pow(sun, 400.0)) * (1.0 - res.w)) * ownSun;
    return col;
}
vec3 skyView(vec2 frag, float clear_, float lookAt, float flip_, float lift, float stretch_, float swing) {
    clearing = clear_; flip = flip_; stretch = stretch_; lookAtNow = lookAt;
    vec2 p = (-RENDERSIZE + 2.0 * frag) / RENDERSIZE.y;
    p.y *= flip;
    Camera c = skyCamera(lookAt, lift, swing, cloudClock);
    vec3 rd = normalize(p.x * c.side + p.y * c.up + 1.5 * c.w);
    return skyRender(c.ro, rd);
}
vec3 shownColour(int i) { return vec3(stored(i), stored(i + 1), stored(i + 2)); }

vec4 drawClouds(vec2 frag) {
    skyTopColor = shownColour(SKY_TOP); skyColor = shownColour(SKY); skyHorizonColor = shownColour(HORIZON); skyGlowColor = shownColour(GLOW);
    cloudColor = shownColour(CLOUD); cloudShadowColor = shownColour(SHADOW); sunColor = shownColour(SUN); sunGlareColor = shownColour(GLARE); sunlightColor = shownColour(SUNLIGHT);
    sundir = stateAt(LIGHT).xyz;
    vec4 clockPx = stateAt(CLOCK);
    cloudClock = clockPx.x;
    cloudBase = stored(CLOUD_BASE); spiral = stored(SPIRAL);
    spin = here().x >= 0.0 ? 1.0 : -1.0;
    // the picture of the sky, and how much of it is cloud (for the sun, moon and
    // stars drawn in the sky to hide behind)
    vec3 now = skyView(frag, stored(CLEARING), stored(LOOK_AT), stored(FLIP), stored(LIFT), stored(STRETCH), stored(SWING));
    float nowCover = cloudCover;
    if (clockPx.y < 0.5) return vec4(now, nowCover);
    // a dissolve: the view it is changing from, fading away over the new one
    vec4 a = stateAt(LIGHT + 1), b = stateAt(LIGHT + 2);
    vec3 was = skyView(frag, a.x, a.y, a.z, a.w, b.x, b.y);
    return vec4(mix(was, now, clockPx.z), mix(cloudCover, nowCover, clockPx.z));
}

// ---- 3. the picture: the clouds scaled up, the weather over them
// the clouds scaled up with a cubic B-spline, sixteen reads, which leaves no grid
vec4 softClouds(vec2 frag) {
    vec2 size = vec2(textureSize(clouds, 0));
    vec2 st = frag / iResolution.xy * size - 0.5, i = floor(st), f = st - i;
    vec4 wx = vec4((1.0 - f.x) * (1.0 - f.x) * (1.0 - f.x), 4.0 - 6.0 * f.x * f.x + 3.0 * f.x * f.x * f.x, 0.0, f.x * f.x * f.x) / 6.0;
    wx.z = 1.0 - wx.x - wx.y - wx.w;
    vec4 wy = vec4((1.0 - f.y) * (1.0 - f.y) * (1.0 - f.y), 4.0 - 6.0 * f.y * f.y + 3.0 * f.y * f.y * f.y, 0.0, f.y * f.y * f.y) / 6.0;
    wy.z = 1.0 - wy.x - wy.y - wy.w;
    ivec2 top = ivec2(size) - 1;
    vec4 c = vec4(0.0);
    for (int y = 0; y < 4; y++)
        for (int x = 0; x < 4; x++)
            c += texelFetch(clouds, clamp(ivec2(i) + ivec2(x - 1, y - 1), ivec2(0), top), 0) * wx[x] * wy[y];
    return c;
}

// Dave Hoskins' hash: no sin() and no huge multiplier, so every graphics
// card gives a corner of the noise's grid one value
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
// the lumps lightning lights up in the cloud: three layers of noise, each
// turned against the last, since a bright flash shows the square grid the
// noise is built on, which the finer layers of fbm leave in it
float billowNoise(vec2 p) {
    float v = 0.0, a = 0.5;
    mat2 turn = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 3; i++) { v += a * noise(p); p = turn * p * 2.03 + 17.1; a *= 0.5; }
    return v / 0.875;
}
// lays a colour over what the layer holds so far, as much as a covers
void put(inout vec4 acc, vec3 c, float a) { acc = vec4(c * a, a) + acc * (1.0 - a); }

// ---- the pieces of weather, drawn over the clouds

// Rain at three depths: soft slanting streaks of every length. The rain
// sets how many; the rest its shape: drop spacing across and down, how fast
// they fall, their length, width and brightness. Returns the light it adds.
float rainLayers(vec2 p, vec2 uv, float t, float amount, float slant, float xs, float ys, float fall, float lenMin, float lenVar, float width, float bright) {
    float light = 0.0;
    for (int l = 0; l < 3; l++) {
        float fl = float(l);
        vec2 rq = vec2((p.x + uv.y * slant) * (xs - fl * xs * 0.2571), uv.y * (ys - fl * ys * 0.2571) + t * (fall - fl * fall * 0.2308));
        vec2 cell = floor(rq); float r = hash(cell + fl * 11.0);
        float y0 = hash(cell + 5.0 + fl) * 0.5, len = lenMin + lenVar * hash(cell + 2.2);
        float fy = fract(rq.y) - y0;
        float xoff = fract(rq.x) - 0.5 - (hash(cell + 9.0) - 0.5) * 0.7;
        float streak = step(1.0 - 0.3 * amount, r) * smoothstep(width + fl * width / 3.0, 0.0, abs(xoff)) * smoothstep(0.0, len * 0.6, fy) * smoothstep(len, len * 0.7, fy);
        light += streak * (0.07 + 0.06 * fl) * (0.6 + 0.4 * hash(cell + 4.4)) * min(amount, 1.0) * bright;
    }
    return light;
}

// Water running down the glass in a downpour: here and there a drop slides
// down, wobbling, leaving a wet trail, and more start as the old ones go.
void glassWater(inout vec4 acc, inout vec3 add, vec2 p, float t, float amount, vec3 light, float lum) {
    for (int l = 0; l < 2; l++) {
        float fl = float(l), cw = 0.055 - fl * 0.018;
        float cx = floor(p.x / cw), h = hash(vec2(cx, fl * 7.0 + 3.0));
        if (h > amount * 0.55) continue;
        float speed = 0.12 + 0.3 * hash(vec2(cx, fl + 11.0)), start = hash(vec2(cx + 2.0, fl));
        float run = fract(t * speed + start);
        float x0 = (cx + 0.3 + 0.4 * hash(vec2(cx, fl + 5.0))) * cw;
        float y = 1.15 - run * 1.35;
        float wob = sin(p.y * 40.0 + cx) * 0.003 + sin(t * 2.0 + cx) * 0.002;
        float rad = 0.007 + 0.006 * hash(vec2(cx, fl + 9.0));
        vec2 dq = vec2(p.x - x0 - wob, (p.y - y) / 1.3);
        float dd = length(dq);
        float body = smoothstep(rad, rad * 0.75, dd);
        float trail = step(y, p.y) * smoothstep(0.28, 0.0, p.y - y) * smoothstep(rad * 0.5, rad * 0.1, abs(p.x - x0 - wob));
        float shine = exp(-length(dq - vec2(-0.3, 0.35) * rad) / (rad * 0.2));
        put(acc, vec3(0.0), body * 0.18);
        add += (light * body * 0.25 + vec3(1.0) * shine * 0.6 * body + light * trail * 0.07) * lum;
    }
}

// Ice pellets bouncing down, small, bright and quick; and beads of ice
// frozen on the glass
void icePellets(inout vec3 add, vec2 p, vec2 uv, float t, float amount, float slant, float lum) {
    for (int l = 0; l < 3; l++) {
        float fl = float(l), sc = 34.0 - fl * 8.0;
        vec2 sq = vec2((p.x + uv.y * slant * 0.5) * sc, uv.y * sc * 0.6 + t * (7.0 + fl * 3.0));
        vec2 cell = floor(sq), f = fract(sq) - 0.5; float r = hash(cell + fl * 5.0 + 40.0);
        vec2 o = vec2(hash(cell + 1.1) - 0.5, hash(cell + 2.3) - 0.5) * 0.5;
        vec2 e = (f - o) * vec2(1.0, 0.7);
        add += vec3(0.92, 0.96, 1.0) * step(0.62 + fl * 0.08, r) * smoothstep(0.07 + fl * 0.03, 0.0, length(e)) * (0.55 + 0.15 * fl) * lum * amount;
    }
    vec2 bq = p * 26.0, cell = floor(bq), f = fract(bq) - 0.5;
    vec2 o = vec2(hash(cell + 7.0) - 0.5, hash(cell + 8.0) - 0.5) * 0.6;
    float bead = step(0.82, hash(cell + 9.5)) * smoothstep(0.12, 0.06, length(f - o));
    float glint = step(0.82, hash(cell + 9.5)) * exp(-length(f - o - vec2(-0.03, 0.04)) * 60.0);
    add += (vec3(0.8, 0.88, 1.0) * bead * 0.08 + vec3(1.0) * glint * 0.4) * lum * amount;
}

// Hail: stones tumbling down at three depths, blurred long by their speed,
// and now and then one striking the glass with a flash and a ring of spray
void hailstones(inout vec4 acc, inout vec3 add, vec2 p, vec2 uv, float t, float amount, float slant, float lum, float aspect) {
    for (int l = 0; l < 3; l++) {
        float fl = float(l), sc = 22.0 - fl * 5.0;
        vec2 sq = vec2((p.x + uv.y * slant * 0.4) * sc, uv.y * sc * 0.5 + t * (6.0 + fl * 2.5));
        vec2 cell = floor(sq), f = fract(sq) - 0.5; float r = hash(cell + fl * 3.0 + 60.0);
        vec2 o = vec2(hash(cell + 4.1) - 0.5, hash(cell + 5.3) - 0.5) * 0.5;
        vec2 e = (f - o) * vec2(1.0, 0.6);
        float rad = (0.045 + 0.03 * fl) * (0.6 + 0.8 * hash(cell + 6.6));
        float stone = step(0.78 - fl * 0.05, r) * smoothstep(rad, rad * 0.55, length(e));
        float shade = 0.72 + 0.28 * clamp(-e.x * 6.0 + e.y * 8.0 + 0.5, 0.0, 1.0);
        put(acc, vec3(0.9, 0.93, 0.97) * shade * (0.55 + 0.6 * lum), stone * (0.55 + 0.15 * fl) * amount);
    }
    for (int k = 0; k < 4; k++) {
        float slot = floor(t / 0.45) - float(k);
        float when = slot * 0.45 + hash(vec2(slot, 1.7)) * 0.45, age = t - when;
        if (age < 0.0 || age > 0.45 || hash(vec2(slot, 2.9)) > amount * 0.8) continue;
        vec2 at = vec2((0.08 + 0.84 * hash(vec2(slot, 3.3))) * aspect, 0.12 + 0.76 * hash(vec2(slot, 4.4)));
        float d = length(p - at);
        float flash = exp(-age * 18.0) * exp(-d * 90.0) * 1.2;
        float ring = smoothstep(0.004, 0.0, abs(d - 0.015 - age * 0.12)) * (1.0 - age / 0.45) * 0.5;
        add += vec3(0.92, 0.95, 1.0) * (flash + ring) * lum;
    }
}

// The land at the horizon under a storm: dark, flat, a treeline along its top
// softened by the distance and the rain; it takes the storm's own light
float horizonLand(vec2 p, vec2 uv) {
    float edge = 0.075 + 0.006 * fbm(vec2(p.x * 9.0, 2.0)) + 0.009 * pow(fbm(vec2(p.x * 24.0, 5.0)), 2.0) * 2.0;
    return smoothstep(0.003, -0.002, uv.y - edge);
}

// A tornado, drawn to match the storm it hangs from: a condensation funnel in
// the cloud's own colours, lit from one side, its edge soft and ragged, faint
// striations turning round it faster where it narrows, lowering from a wall
// cloud to the ground, where a dust cloud churns; rain curtains beside it
void tornado(inout vec4 acc, vec2 p, vec2 uv, float t, float aspect, float amount, vec3 lit, vec3 shade, float drift) {
    float top = 0.93, ground = 0.075;
    float cx0 = aspect * (0.6 + 0.05 * sin(t * 0.04));
    // grey rain curtains either side, drifting
    float curtain = fbm(vec2(p.x * 2.2 - drift * 0.05, uv.y * 0.6)) * smoothstep(0.95, 0.4, uv.y);
    float away = smoothstep(0.08, 0.3, abs(p.x - cx0));
    put(acc, mix(shade, lit, 0.35), smoothstep(0.5, 0.75, curtain) * 0.35 * away * amount);
    float s = (uv.y - ground) / (top - ground);
    if (s > -0.1 && s < 1.1) {
        float sc = clamp(s, 0.0, 1.0);
        float cx = cx0 + 0.1 * sc * sc - 0.04 * sc + 0.02 * sin(sc * 6.0 + t * 0.5) * (1.0 - sc);
        // narrow and roped low down, flaring into the wall cloud at the top
        float w = 0.022 + 0.05 * sc + 0.34 * pow(sc, 5.0) + 0.006 * sin(sc * 23.0 + t);
        float u = (p.x - cx) / w;
        float ragged = (fbm(vec2(u * 1.5 + t * 0.3, sc * 7.0 - t * 0.4)) - 0.5) * 0.45;
        float body = smoothstep(1.0, 0.55, abs(u) + ragged) * smoothstep(-0.06, 0.05, s);
        if (body > 0.0) {
            float spin = t * 1.6 / (w * 9.0 + 0.4);
            float stria = fbm(vec2(asin(clamp(u, -1.0, 1.0)) * 1.8 + spin, sc * 26.0));
            float light = clamp(0.45 - 0.35 * u, 0.0, 1.0);
            vec3 c = mix(shade * 0.85, lit * 0.8, light) * (0.88 + 0.24 * stria);
            // near the ground the funnel is dust as much as cloud
            c = mix(c, vec3(0.3, 0.26, 0.21) * (0.6 + 0.6 * light), smoothstep(0.25, 0.0, sc) * 0.6);
            put(acc, c, body * amount * (0.82 + 0.18 * stria) * smoothstep(1.08, 0.9, s));
        }
    }
    // the debris cloud: billowing dust churning round the funnel's foot
    vec2 d = (p - vec2(cx0, ground + 0.03)) / vec2(0.15, 0.07);
    float r = length(d);
    if (r < 1.4) {
        float swirl = fbm(vec2(atan(d.y, d.x) * 1.6 - t * 1.8, r * 3.0 - t * 0.5) + 3.0);
        float billow = smoothstep(1.05, 0.45, r + (swirl - 0.5) * 0.8);
        put(acc, mix(vec3(0.24, 0.21, 0.17), mix(shade, lit, 0.5) * 0.9, 0.35) * (0.8 + 0.3 * swirl), billow * 0.8 * amount);
    }
}

// Ice crystals on the glass in the cold: six-armed dendrites, each arm
// branching, scattered across the glass and thicker toward its edges, with a
// fine frost haze at the very edges; they catch the light at their rims
float crystal(vec2 q, float size) {
    float r = length(q);
    if (r > size) return 0.0;
    float a = atan(q.y, q.x);
    a = mod(a + 3.14159 / 6.0, 3.14159 / 3.0) - 3.14159 / 6.0;
    vec2 k = vec2(cos(a), sin(abs(a))) * r;
    float line = smoothstep(size * 0.035, 0.0, k.y) * smoothstep(size, size * 0.85, k.x);
    // side branches off the arm, at sixty degrees, shorter toward the tip
    for (int i = 1; i <= 3; i++) {
        float at = size * (0.2 + 0.22 * float(i)), len = (size - at) * 0.55;
        vec2 b = k - vec2(at, 0.0);
        float along = dot(b, vec2(0.5, 0.866));
        float off = abs(dot(b, vec2(-0.866, 0.5)));
        line = max(line, smoothstep(size * 0.028, 0.0, off) * step(0.0, along) * smoothstep(len, len * 0.7, along));
    }
    return line * smoothstep(size, size * 0.3, r) + smoothstep(size * 0.12, 0.0, r) * 0.6;
}
void iceOnGlass(inout vec4 acc, inout vec3 add, vec2 p, vec2 uv, float aspect, float amount, float night, float lum) {
    float e = min(min(uv.x, 1.0 - uv.x) * aspect, min(uv.y, 1.0 - uv.y));
    // the frost grows in from the edges: crystals crowd there, overlapping,
    // and thin out toward the middle, where only the odd small one forms
    float reach = 0.1 + 0.18 * amount;
    float edgeness = smoothstep(reach, 0.0, e + (fbm(p * 6.0) - 0.5) * 0.08);
    float ice = 0.0;
    for (int l = 0; l < 3; l++) {
        float fl = float(l), cs = 0.09 - fl * 0.025;
        vec2 g = p / cs + fl * 7.3, cell = floor(g);
        float h = hash(cell + fl * 3.0 + 200.0);
        if (h > amount * (0.015 + 0.95 * edgeness)) continue;
        vec2 o = vec2(hash(cell + 1.9), hash(cell + 2.7)) * 0.5 + 0.25;
        float rot = hash(cell + 3.3) * 1.05;
        vec2 q = (fract(g) - o) * cs;
        q = mat2(cos(rot), sin(rot), -sin(rot), cos(rot)) * q;
        ice = max(ice, crystal(q, cs * (0.35 + 0.4 * hash(cell + 4.4)) * (0.6 + 0.4 * amount)) * (0.5 + 0.5 * hash(cell + 5.1)));
    }
    // a frosted film along the very edge, where the crystals have grown together
    float film = edgeness * smoothstep(0.35, 0.8, fbm(p * 22.0 + 4.0)) * 0.55 + smoothstep(reach * 0.35, 0.0, e) * 0.35;
    vec3 tone = vec3(0.88, 0.94, 1.0) * mix(1.0, 0.45, night) * (0.6 + 0.5 * lum);
    put(acc, tone, clamp(ice * 0.5 + film, 0.0, 0.85) * min(amount * 1.4, 1.0));
    add += tone * ice * 0.1;
}

vec3 drawPicture(vec2 frag) {
    int W = int(stateAt(META).x);
    float night = stored(NIGHT), dusk = stored(DUSK);
    float aClear = stored(A_CLEAR), aCloudy = stored(A_CLOUDY), aRain = stored(A_RAIN), aSnow = stored(A_SNOW), aBlizzard = stored(A_BLIZZARD), aStorm = stored(A_STORM), aFog = stored(A_FOG);
    vec3 cloudLight = shownColour(CLOUD);
    vec4 pin = stateAt(PINNED);
    vec2 sunPos = pin.xy, moonPos = pin.zw;
    float moonUp = stored(MOON_UP), phase = moonPhase(), wind = stored(GUST), t = iTime;
    float aPartly = stored(A_PARTLY), aDrizzle = stored(A_DRIZZLE), aHeavy = stored(A_HEAVY), aShowers = stored(A_SHOWERS), aSleet = stored(A_SLEET);
    float aHail = stored(A_HAIL), aWindy = stored(A_WINDY), aHaze = stored(A_HAZE), aHurricane = stored(A_HURRICANE), aTornado = stored(A_TORNADO);
    float windX = stored(WIND_X), side = windX >= 0.0 ? 1.0 : -1.0, frost = stored(FROST), heat = stored(HEAT);
    // how far the wind has carried things (see DRIFT): across the screen, and gusting
    vec4 drift = stateAt(DRIFT);
    vec2 size = iResolution.xy;

    vec2 uv = frag / size; float aspect = size.x / size.y; vec2 p = vec2(uv.x * aspect, uv.y);
    vec3 add = vec3(0.0); vec4 acc = vec4(0.0);
    float dim = 1.0 - 0.7 * night;
    // the sky, shimmering in the heat low down, and how much of each point is cloud
    vec2 shimmer = heat > 0.003 ? vec2(noise(vec2(frag.x * 0.02, frag.y * 0.08 - t * 3.0)) - 0.5, noise(vec2(frag.y * 0.05 + t * 2.0, frag.x * 0.03)) - 0.5) * heat * 6.0 * smoothstep(0.55, 0.0, uv.y) : vec2(0.0);
    vec4 skyPicture = softClouds(frag + shimmer);
    // how much of the view is open sky, where the sun, moon and stars can be seen
    float skyOpen = clamp(aClear + aHaze + aCloudy + aPartly + aWindy, 0.0, 1.0);
    // a clear sky's sun, drawn sharp at full size where Sky's camera sees it;
    // it fades with the clear sky, faster than the cloud forms, so it is
    // never drawn over cloud
    float sunW = skyOpen * skyOpen * skyOpen * (1.0 - night);
    if (sunW > 0.003) {
        vec2 q = (uv * 2.0 - 1.0) * vec2(aspect, 1.0);
        float up = uv.y * 0.9;
        vec2 sp = (sunPos * 2.0 - 1.0) * vec2(aspect, 1.0);
        vec2 dv = q - sp; float d = length(dv), px = 2.0 / size.y;
        vec4 acc0 = acc; vec3 add0 = add;
        if (dusk < 0.999) {
            // by day: a big white-hot disc in a bright glow that fades wide into the sky
            float r = 0.24, k = 0.6;
            float disc = smoothstep(r + px * 2.0, r - px * 2.0, d);
            float halo = exp(-max(d - r, 0.0) * 17.0 * k) * 0.5;
            put(acc, vec3(1.0, 0.86, 0.5), halo * (1.0 - disc));
            put(acc, mix(vec3(1.0, 0.99, 0.9), vec3(1.0, 0.94, 0.68), pow(clamp(d / r, 0.0, 1.0), 9.0)), disc);
            add += vec3(1.0, 0.9, 0.5) * disc * 0.08;
            add += vec3(1.0, 0.84, 0.46) * (exp(-max(d - r, 0.0) * 3.0 * k) * 0.2 + exp(-max(d - r, 0.0) * 12.0 * k) * 0.18);
            add += vec3(1.0, 0.88, 0.62) * (exp(-d * 1.4) * 0.12 + exp(-d * 0.6) * 0.05) * (1.0 - disc);
        }
        vec4 accDay = acc; vec3 addDay = add; acc = acc0; add = add0;
        if (dusk > 0.001) {
            // at sunset: a big bright disc, pale gold, resting on the horizon, warm
            // light spread along the horizon, streaks of cloud lit gold and orange
            float r = 0.3;
            float land = 0.0, sky = 1.0;
            vec2 w = vec2(p.x * 0.8 - drift.x * 0.005, uv.y * 8.5);
            float warp = fbm(w * vec2(0.45, 1.0) + vec2(3.0, t * 0.01));
            float n = fbm(w + vec2(warp * 1.6, 0.0));
            float below = fbm(w + vec2(warp * 1.6, -0.22));
            float streak = smoothstep(0.47, 0.68, n) * smoothstep(0.3, 0.5, uv.y) * (1.0 - smoothstep(0.85, 1.0, uv.y));
            vec3 lit = mix(vec3(1.0, 0.72, 0.36), vec3(0.95, 0.5, 0.42), smoothstep(0.35, 0.8, uv.y));
            lit += vec3(1.0, 0.7, 0.35) * exp(-d * 2.2) * 0.3;
            vec3 sc = mix(lit, vec3(0.42, 0.24, 0.3), smoothstep(0.0, 0.18, below - n) * 0.75);
            put(acc, sc, streak * 0.8);
            add += vec3(1.0, 0.62, 0.28) * exp(-abs(up) * 60.0) * exp(-abs(dv.x) * 0.9) * 0.3 * mix(1.0, sky, 0.6);
            float disc = smoothstep(r + px * 3.5, r - px * 3.5, d);
            add += vec3(1.0, 0.72, 0.36) * exp(-max(d - r, 0.0) * 13.0) * 0.32 * (1.0 - disc) * (1.0 - land);
            put(acc, vec3(1.0, 0.92, 0.6), disc);
            add += vec3(1.0, 0.92, 0.6) * disc * 0.25 * (1.0 - land);
        }
        acc = mix(accDay, acc, dusk); add = mix(addDay, add, dusk);
        acc = mix(acc0, acc, sunW); add = mix(add0, add, sunW);
        // through haze or smoke the sun is dimmed and reddened
        if (aHaze > 0.003) {
            float k = clamp(aHaze, 0.0, 1.0);
            acc.rgb *= mix(vec3(1.0), vec3(1.0, 0.72, 0.5), k); acc *= 1.0 - 0.35 * k;
            add *= mix(vec3(1.0), vec3(0.95, 0.55, 0.32), k);
        }
    }
    // night: a navy sky full of fine stars, faint wisps drifting through it,
    // and the moon, photographed, glowing softly, in today's phase; the moon
    // and stars come out once the sky has darkened
    float nightW = smoothstep(0.35, 1.0, night) * skyOpen;
    if (nightW > 0.003) {
        vec4 accN0 = acc; vec3 addN0 = add;
        // (the clouds, below, hide the stars where they are)
        float clearSky = aClear + aHaze;
        float open = smoothstep(0.0, 0.25, uv.y);
        vec2 mc = vec2(moonPos.x * aspect, moonPos.y); float mr = 0.13;
        float moonW = skyOpen * moonUp;
        float behind = mix(1.0, smoothstep(mr * 0.98, mr * 1.02, length(p - mc)), moonW);
        for (int l = 0; l < 3; l++) {
            float fl = float(l), sc = 60.0 + fl * 55.0; vec2 g = p * sc; vec2 cell = floor(g); float r = hash(cell + fl * 13.0);
            vec2 o = vec2(hash(cell + 3.1), hash(cell + 7.7)) * 0.7 + 0.15;
            float tw = 0.7 + 0.3 * sin(t * (0.8 + r * 2.5) + r * 40.0);
            float starSize = 0.06 + 0.07 * hash(cell + 2.4) * (1.0 - fl * 0.3);
            add += mix(vec3(1.0, 0.92, 0.84), vec3(0.82, 0.88, 1.0), hash(cell + 5.5)) * step(0.88, r) * smoothstep(starSize, 0.0, length(fract(g) - o)) * tw * (0.3 + 0.7 * pow(hash(cell + 1.3), 2.0)) * open * behind;
        }
        if (clearSky > 0.01) {
            vec2 w = vec2(p.x * 0.8 - drift.x * 0.004, uv.y * 3.2);
            float n = fbm(w + vec2(fbm(w * vec2(0.4, 1.0) + 7.0) * 1.8, 0.0));
            put(acc, vec3(0.3, 0.32, 0.52), smoothstep(0.5, 0.75, n) * smoothstep(0.2, 0.5, uv.y) * 0.2 * clearSky);
        }
        vec2 m = (p - mc) / mr; float md = length(p - mc);
        float full = 0.35 + 0.65 * sin(phase * 3.14159);
        float outside = smoothstep(mr * 0.85, mr * 1.0, md);
        // the glow comes from the lit part: all round at full, from the bright edge of a crescent
        float sunSide = sin(phase * 6.28318);
        float glowSide = mix(1.0, smoothstep(-0.7, 0.9, dot((p - mc) / max(md, 1e-4), vec2(sunSide > 0.0 ? 1.0 : -1.0, 0.0))), abs(sunSide));
        add += vec3(0.6, 0.68, 0.95) * (exp(-max(md - mr, 0.0) * 14.0) * 0.22 + exp(-max(md - mr, 0.0) * 3.5) * 0.08 + exp(-md * 1.2) * 0.04) * full * outside * glowSide * moonW;
        if (dot(m, m) < 1.1 && moonW > 0.003) {
            float px = 1.5 / (mr * size.y);
            float edge = smoothstep(1.0 + px * 1.5, 1.0 - px * 1.5, length(m));
            vec3 photo = texture(moon, m * 0.47 + 0.5).rgb;
            vec3 nrm = vec3(m, sqrt(max(1.0 - dot(m, m), 0.0)));
            float a = phase * 6.28318;
            float lit = smoothstep(-0.06, 0.08, dot(nrm, vec3(sin(a), 0.0, -cos(a))));
            // seen through the air: its light added to the sky, the sky's blue
            // showing across it; only the stars behind it are hidden
            float luma = dot(photo, vec3(0.3, 0.59, 0.11));
            vec3 face = mix(photo, vec3(luma), 0.15) * vec3(0.9, 0.94, 1.04) * lit * 1.05 * (1.0 + 0.12 * smoothstep(0.75, 1.0, length(m)));
            // the dark part still faintly there in earthshine
            vec3 darkSide = mix(photo, vec3(luma), 0.4) * vec3(0.55, 0.62, 0.85) * 0.09 * (1.0 - lit);
            add += (face + darkSide) * edge * moonW;
            put(acc, vec3(0.0), edge * 0.3 * smoothstep(1.0, 0.8, length(m)) * moonW);
        }
        acc = mix(accN0, acc, nightW); add = mix(addN0, add, nightW);
    }
    // the sun, moon and stars are behind the clouds, and dimmed through haze or smoke
    acc *= 1.0 - skyPicture.a; add *= 1.0 - skyPicture.a;
    if (aHaze > 0.003 && night > 0.001) add *= mix(vec3(1.0), vec3(0.75, 0.55, 0.42), clamp(aHaze, 0.0, 1.0) * night);
    // windy: high streaks of cirrus racing over, drawn out long by the wind
    if (aWindy > 0.003) {
        float w = fbm(vec2(p.x * 0.9 - drift.z * 0.6, p.y * 14.0)) * fbm(vec2(p.x * 2.4 - drift.z * 0.9, p.y * 22.0 + 3.0));
        put(acc, vec3(0.95, 0.96, 1.0) * dim, smoothstep(0.2, 0.45, w) * smoothstep(0.5, 0.85, uv.y) * 0.6 * aWindy);
    }
    // cloudy: high wisps drifting over, in the strip of sky above the cloud
    if (aCloudy > 0.003) {
        float w = fbm(vec2(p.x * 2.2 + drift.x * 0.03, p.y * 7.0 + t * 0.01)) * fbm(vec2(p.x * 5.0 - drift.x * 0.02, p.y * 12.0));
        float wisp = smoothstep(0.18, 0.42, w) * smoothstep(0.45, 0.8, uv.y);
        put(acc, vec3(0.95, 0.96, 1.0) * dim, wisp * 0.55 * aCloudy);
    }
    // rain: soft slanting streaks of every length, falling past at three depths
    float lum = 0.35 + 0.65 * dot(cloudLight, vec3(0.33));
    // the rain leans with the wind across the screen
    float slant = windX * (0.12 + 0.12 * wind);
    vec3 rainTone = vec3(0.85, 0.9, 1.0) * lum;
    if (aRain > 0.003) add += rainTone * rainLayers(p, uv, t, aRain, slant, 70.0, 7.0, 13.0, 0.22, 0.3, 0.12, 1.0);
    // drizzle: fine short drops, slow and many, in a mist
    if (aDrizzle > 0.003) {
        add += rainTone * rainLayers(p, uv, t, aDrizzle * 1.7, slant * 0.6, 120.0, 14.0, 5.0, 0.08, 0.1, 0.09, 1.3);
        put(acc, mix(vec3(0.8, 0.84, 0.88), vec3(0.2, 0.22, 0.28), night), (0.1 + 0.12 * fbm(vec2(p.x * 1.2 + drift.x * 0.03, uv.y * 2.0))) * aDrizzle);
    }
    // a downpour: long, dense, fast streaks, sheets of rain sweeping across, water running down the glass
    if (aHeavy > 0.003) {
        add += rainTone * rainLayers(p, uv, t, aHeavy * 1.7, slant * 1.3, 60.0, 4.0, 20.0, 0.35, 0.35, 0.14, 1.4);
        float sheet = fbm(vec2(p.x * 1.4 - drift.w * 0.8, uv.y * 1.5 + t * 0.9));
        put(acc, mix(vec3(0.62, 0.66, 0.72), vec3(0.14, 0.16, 0.2), night), smoothstep(0.35, 0.8, sheet) * 0.32 * aHeavy);
        glassWater(acc, add, p, t, aHeavy, cloudLight, lum);
    }
    // showers: rain falling out of broken cloud
    if (aShowers > 0.003) add += rainTone * rainLayers(p, uv, t, aShowers * 0.8, slant, 70.0, 7.0, 13.0, 0.22, 0.3, 0.12, 0.9);
    // sleet: quick short rain, ice pellets, beads of ice on the glass
    if (aSleet > 0.003) {
        add += rainTone * rainLayers(p, uv, t, aSleet * 0.9, slant, 80.0, 9.0, 16.0, 0.12, 0.12, 0.1, 0.9);
        icePellets(add, p, uv, t, aSleet, slant, lum);
    }

    // snow: flakes drifting down, the near ones big and soft
    if (aSnow > 0.003) {
        for (int l = 0; l < 4; l++) {
            float fl = float(l), sc = 26.0 - fl * 5.0;
            vec2 sq = vec2(p.x * sc + sin(t * 0.4 + fl * 2.0 + uv.y * 3.0) * 0.8 * wind - drift.x * 0.3, uv.y * sc + t * (0.9 + fl * 0.45));
            vec2 cell = floor(sq), f = fract(sq) - 0.5; float r = hash(cell + fl * 7.0);
            vec2 o = vec2(hash(cell + 1.7) - 0.5, hash(cell + 2.9) - 0.5) * 0.5 + vec2(sin(t * 1.1 + r * 30.0), cos(t * 0.9 + r * 20.0)) * 0.12;
            float rad = 0.05 + fl * 0.03, soft = 0.25 + fl * 0.22;
            add += vec3(1.0) * step(0.7 + fl * 0.06, r) * smoothstep(rad, rad * (1.0 - soft) * 0.4, length(f - o)) * (0.75 - fl * 0.12) * lum * aSnow;
        }
    }
    // storms: lightning glowing inside the clouds, now and then, flickering as it dies
    float glow = 0.0;
    if (aStorm > 0.003) {
        float n = floor(t / 3.7), at = fract(t / 3.7) * 3.7;
        if (hash(vec2(n, 3.0)) > 0.3) {
            float a = at - hash(vec2(n, 4.0)) * 1.5;
            if (a > 0.0) {
                float f = exp(-a * 5.0) * (0.55 + 0.45 * step(0.5, fract(a * 11.0))) + 0.6 * exp(-max(a - 0.18, 0.0) * 9.0) * step(0.18, a);
                vec2 c = vec2((0.15 + 0.7 * hash(vec2(n, 1.0))) * aspect, 0.5 + 0.35 * hash(vec2(n, 2.0)));
                float billow = smoothstep(0.25, 0.75, billowNoise(vec2(p.x * 3.0 + n * 7.0, uv.y * 5.0)));
                glow += f * (exp(-length((p - c) * vec2(0.8, 1.6)) * 2.2) * (0.5 + 1.2 * billow) + 0.12) * aStorm;
            }
        }
    }
    // ---- presses: each key's centre, how long ago, and a number of its own
    float part = 0.0;
    for (int i = 0; i < 8; i++) {
        vec4 key = iKeyPresses[i];
        if (key.w < 0.0) continue;
        float age = key.z;
        float seed = hash(vec2(key.w * 7.31, floor((iTime - age) * 4.0 + 0.5))) * 100.0;
        vec4 k = vec4(key.x / size.x, key.y / size.y, age, seed);
        vec2 kp = vec2(k.x * aspect, k.y); vec2 d = p - kp;
        // a storm: lightning flares in the cloud at the key, and a bolt strikes down to it
        if (stormy(W) && age < 0.9) {
            float flick = 0.55 + 0.45 * step(0.5, fract(age * 16.0));
            float billow = smoothstep(0.2, 0.75, billowNoise(vec2(p.x * 3.2 + k.w, uv.y * 5.5 - age)));
            glow += (1.0 - smoothstep(0.0, 0.9, age)) * flick * (exp(-length(d * vec2(0.6, 1.3)) * 3.2) * (0.4 + 1.5 * billow) + 0.12);
            if (uv.y > kp.y && age < 0.35) {
                float jag = kp.x + (noise(vec2(uv.y * 9.0, k.w)) - 0.5) * 0.12 + (noise(vec2(uv.y * 40.0, k.w + 3.0)) - 0.5) * 0.03;
                float dx = abs(p.x - jag), life = (1.0 - age / 0.35) * (0.6 + 0.4 * step(0.5, fract(age * 18.0)));
                add += vec3(0.88, 0.92, 1.0) * (exp(-dx * 500.0) * 1.6 + exp(-dx * 40.0) * 0.25) * life;
            }
        }
        // clear and cloudy days: a soft cloud puffs up at the key, rises and thins away
        bool calm = W == CLEAR || W == CLOUDY || W == PARTLY || W == WINDY || W == HAZE;
        if (calm && night < 0.5 && age < 5.0) {
            float grow = 1.0 - exp(-age * 2.5), rad = 0.1 + 0.14 * grow;
            vec2 c = kp + vec2(age * 0.015 * wind, age * 0.018);
            vec2 r = (p - c) / rad; r.y *= 1.35;
            float lumps = fbm(r * 1.3 + k.w + vec2(t * 0.15, 0.0));
            float body = smoothstep(1.15, 0.55, length(r) + (0.5 - lumps) * 0.9);
            float fade = smoothstep(0.0, 0.3, age) * (1.0 - smoothstep(2.0, 5.0, age));
            float thin = smoothstep(0.35 + 0.4 * smoothstep(2.0, 5.0, age), 0.8, lumps + body * 0.4);
            float a = body * thin * fade * 0.95;
            vec3 pc = mix(mix(cloudLight * 0.7, vec3(0.55, 0.47, 0.66), dusk), mix(vec3(1.0, 0.99, 0.97), vec3(1.0, 0.76, 0.7), dusk), smoothstep(-0.8, 0.9, r.y + lumps * 0.8));
            put(acc, pc, a);
        }
        // night: a shooting star streaks in from out of frame, high on the far
        // side, and lands on the key, flashing where it hits
        if (calm && night > 0.5 && age < 1.6) {
            float side = kp.x < aspect * 0.5 ? 1.0 : -1.0;
            vec2 dir = normalize(vec2(-side, -0.5 - 0.25 * fract(k.w * 7.0)));
            vec2 start = kp - dir * 1.6;
            float fly = 0.5, e = clamp(age / fly, 0.0, 1.0);
            vec2 head = mix(start, kp, e * e * (3.0 - 2.0 * e) * 0.35 + e * 0.65);
            vec2 r = p - head; float along = dot(r, -dir), across = abs(dot(r, vec2(-dir.y, dir.x)));
            float trail = step(0.0, along) * exp(-along * 5.0) * exp(-across * 650.0) * step(0.0, dot(p - kp, -dir) + 0.002);
            float streak = (1.0 - smoothstep(fly, fly + 0.6, age));
            float hit = smoothstep(fly - 0.05, fly, age) * (1.0 - smoothstep(fly, fly + 0.9, age));
            float dd = length(p - kp);
            add += vec3(0.95, 0.97, 1.0) * (trail * 1.5 + exp(-length(r) * 90.0) * 1.3 * (1.0 - hit)) * streak;
            add += vec3(0.9, 0.94, 1.0) * (exp(-dd * 60.0) * 1.2 + exp(-dd * 14.0) * 0.25) * hit;
        }
        // rain: drops splash onto the glass at the key, bead up catching the
        // light, then run down the glass one by one, leaving wet trails
        if ((W == RAIN || W == DRIZZLE || W == HEAVY || W == SHOWERS || W == SLEET) && age < 6.0) {
            for (int j = 0; j < 18; j++) {
                float fj = float(j), h1 = hash(vec2(k.w, fj)), h2 = hash(vec2(fj, k.w + 5.0)), h3 = hash(vec2(fj + 9.0, k.w));
                vec2 start = kp + (vec2(h1, h2) - 0.5) * vec2(0.26, 0.2);
                float rad = 0.014 + 0.032 * h3 * h3;
                float wait = 0.25 + 1.6 * h2, run = max(age - wait, 0.0);
                vec2 c = start - vec2(sin(run * 3.0 + fj) * 0.004, run * run * (0.03 + 0.07 * h3));
                float life = smoothstep(0.0, 0.07, age) * (1.0 - smoothstep(4.0, 6.0, age));
                vec2 dq = (p - c) / vec2(1.0, 1.0 + 0.25 * smoothstep(0.0, 0.4, run));
                float dd = length(dq);
                float body = smoothstep(rad, rad * 0.82, dd);
                float rim = body - smoothstep(rad * 0.86, rad * 0.55, dd);
                float shine = exp(-length(dq - vec2(-0.32, 0.36) * rad) / (rad * 0.16));
                float trail = step(c.y, p.y) * step(p.y, start.y) * smoothstep(rad * 0.45, rad * 0.1, abs(p.x - c.x - sin((p.y - start.y) * 60.0 + fj) * 0.003)) * smoothstep(0.0, 0.3, run);
                float crescent = body * smoothstep(0.1, 0.85, -dq.y / rad) * smoothstep(1.0, 0.6, dd / rad);
                float edgeTop = rim * smoothstep(-0.3, 0.6, dq.y / rad);
                put(acc, vec3(0.0), edgeTop * 0.3 * life);
                add += (cloudLight * crescent * 0.35 + vec3(1.0) * shine * 0.8 * body + cloudLight * body * 0.05 + cloudLight * trail * 0.08) * life * lum;
            }
        }
        // snow: a snowball thrown at the screen by someone out of view. It
        // flies in from past the edge, growing as it comes at you, and smacks
        // into the screen at the key: a packed, crumbly core with bits of snow
        // sprayed out from it in streaks and clumps, which slips a little down
        // the glass and melts away
        if ((W == SNOW || W == BLIZZARD) && age < 7.0) {
            float fly = 0.42, side = kp.x < aspect * 0.5 ? -1.0 : 1.0;
            // packed snow, white in the day's light and dimmer at night
            float bright = min(1.0, 0.5 + 0.6 * lum);
            vec3 snowLit = vec3(1.0) * bright, snowShade = vec3(0.74, 0.8, 0.9) * bright;
            if (age < fly) {
                float e = age / fly;
                // from past the nearer side edge, a little above, dropping as it comes
                vec2 from = vec2(side > 0.0 ? aspect + 0.25 : -0.25, kp.y + 0.2 + 0.15 * fract(k.w * 3.7));
                vec2 at = mix(from, kp, e) + vec2(0.0, 0.12 * e * (1.0 - e));
                // it comes at you, so it grows, faster as it nears
                float r = mix(0.035, 0.095, e * e);
                vec2 q = (p - at) / r;
                float lumpy = length(q) + (noise(q * 2.2 + k.w) - 0.5) * 0.22;
                float ball = smoothstep(1.0, 0.9, lumpy);
                vec3 n = normalize(vec3(q, sqrt(max(1.0 - dot(q, q), 0.0))));
                float light = clamp(0.5 + 0.5 * dot(n, normalize(vec3(-0.4, 0.6, 0.7))), 0.0, 1.0);
                vec3 c = mix(snowShade, snowLit, light) * (0.88 + 0.12 * fbm(q * 3.0 + k.w));
                put(acc, c, ball);
            } else {
                float since = age - fly;
                // it slips a little down the glass, and melts away
                float slip = 0.03 * (1.0 - exp(-since * 0.6)) + 0.003 * since;
                vec2 c = kp - vec2(0.0, slip);
                vec2 q = p - c;
                float r = length(q);
                vec2 dir = q / max(r, 1e-4);
                float burst = mix(0.75, 1.0, smoothstep(0.0, 0.08, since));
                float melt = 1.0 - smoothstep(2.0, 6.5, since);
                float s = 1.0 / burst;
                // the packed core, an irregular round clump
                float wob = (noise(dir * 2.5 + k.w) - 0.5) * 0.06 + (noise(dir * 6.0 + k.w + 5.0) - 0.5) * 0.025;
                float core = 1.0 - smoothstep(0.08, 0.19, r * s + wob * 1.4);
                // short smears where it spread across the glass as it hit
                float smear = pow(noise(dir * 4.0 + k.w + 9.0), 2.0) * (1.0 - smoothstep(0.1, 0.25, r * s));
                // the grain packed snow breaks into, strongest at the edge
                vec2 g = q / burst;
                float grain = fbm(g * 22.0 + k.w * 3.0), fine = noise(g * 90.0 + k.w);
                float density = core * 1.15 + smear * 0.7 - (1.0 - grain) * 0.75 - (1.0 - fine) * 0.12;
                float snow = smoothstep(0.3, 0.42, density);
                // loose flecks round it, fewer further out
                vec2 fc = g * 55.0, cell = floor(fc);
                float fh = hash(cell + k.w), fleck = step(1.0 - 0.5 * (1.0 - smoothstep(0.12, 0.34, r * s)), fh);
                vec2 fo = vec2(hash(cell + 1.7 + k.w), hash(cell + 2.9 + k.w)) * 0.6 + 0.2;
                float fleckA = fleck * smoothstep(0.22 + 0.2 * hash(cell + 4.1), 0.05, length(fract(fc) - fo)) * (1.0 - core) * (1.0 - snow);
                // lumps catching the light from above: the grain's slope as relief
                float slope = (fbm(g * 22.0 + k.w * 3.0 + vec2(-0.03, 0.03)) - grain) * 12.0;
                float thick = smoothstep(0.35, 0.9, density);
                vec3 col = mix(snowShade, snowLit, clamp(0.55 + 0.3 * thick + slope, 0.0, 1.0));
                put(acc, col, snow * mix(0.8, 1.0, thick) * melt);
                put(acc, snowLit * 0.97, fleckA * 0.9 * melt);
                // a puff of powder as it bursts, spreading and fading fast
                float puff = exp(-r * s * 9.0) * (1.0 - smoothstep(0.0, 0.35, since)) * smoothstep(0.0, 0.03, since);
                add += snowLit * puff * 0.35 * fbm(q * 12.0 - since * 3.0 + k.w);
                // bits flung off as it bursts, slowing and falling away
                if (since < 0.8) {
                    for (int j = 0; j < 14; j++) {
                        float fj = float(j), h1 = hash(vec2(fj + 11.0, k.w)), h2 = hash(vec2(k.w + 4.0, fj)), h3 = hash(vec2(fj, k.w + 13.0));
                        float a = h1 * 6.2832, go = (0.12 + 0.22 * h2) * (1.0 - exp(-since * 8.0));
                        vec2 bit = kp + vec2(cos(a), sin(a)) * go - vec2(0.0, since * since * 0.6);
                        float fr = 0.004 + 0.008 * h3;
                        add += snowLit * smoothstep(fr, fr * 0.3, length(p - bit)) * (1.0 - smoothstep(0.3, 0.8, since)) * 0.85;
                    }
                }
            }
        }
        // fog: it parts around the key, then closes again
        if (W == FOG && age < 6.0) {
            float open = smoothstep(0.0, 0.8, age) * (1.0 - smoothstep(2.5, 6.0, age));
            float rr = 0.16 + 0.22 * smoothstep(0.0, 2.0, age);
            part = max(part, open * smoothstep(rr, rr * 0.3, length(d * vec2(1.0, 1.4)) + (fbm(p * 7.0 + k.w) - 0.5) * 0.08));
        }
    }
    // fog: inside the cloud, everything softened into haze that moves, thinner where a key parted it
    if (aFog > 0.003) {
        float h = 0.55 + 0.3 * fbm(vec2(p.x * 1.4 + drift.x * 0.04, uv.y * 2.5 + t * 0.02));
        put(acc, mix(vec3(0.9, 0.92, 0.95), vec3(0.2, 0.22, 0.28), night), h * 0.85 * (1.0 - part) * aFog);
    }
    // blizzard: snow driven almost sideways by the wind, in gusts, the near
    // flakes drawn out into streaks, and veils of blown snow racing across.
    // How far the wind has carried the snow is its gusting strength,
    // 0.75 + 0.25 sin(0.6t) sin(0.23t + 1), added up over time (worked out
    // exactly), so the snow only ever goes forward
    if (aBlizzard > 0.003) {
        // (it blows the way the wind does across the screen)
        vec2 dir = normalize(vec2(-side, 0.3)), across = vec2(-dir.y, dir.x);
        float blown = drift.z;
        for (int l = 0; l < 6; l++) {
            float fl = float(l), sc = 44.0 - fl * 7.0;
            vec2 bq = vec2(dot(p, dir) * sc * (0.45 - fl * 0.06) + blown * (4.0 + fl * 1.6), dot(p, across) * sc + sin(t * 0.9 + fl * 1.7 + dot(p, dir) * 3.0) * 0.35);
            vec2 cell = floor(bq), f = fract(bq) - 0.5; float r = hash(cell + fl * 13.0);
            vec2 e = f - vec2((hash(cell + 1.3) - 0.5) * 0.4, (hash(cell + 3.1) - 0.5) * 0.6);
            float rad = 0.045 + fl * 0.018;
            add += vec3(0.95, 0.97, 1.0) * step(0.45 + fl * 0.08, r) * smoothstep(rad, 0.0, length(e * vec2(1.0, 1.5))) * (0.75 - fl * 0.1) * lum * aBlizzard;
        }
        float veil = fbm(vec2(p.x * 1.3 - side * blown * 0.7, uv.y * 2.6 + t * 0.12)) * 0.65 + fbm(vec2(p.x * 3.5 - side * blown * 1.6, uv.y * 6.0)) * 0.35;
        put(acc, mix(mix(vec3(0.9, 0.92, 0.96), vec3(0.6, 0.55, 0.64), dusk), vec3(0.3, 0.33, 0.42), night), smoothstep(0.3, 0.8, veil) * mix(0.7, 0.45, night) * (1.0 - part) * aBlizzard);
    }
    // haze, smoke or dust: the air thick and tinted, most of all toward the horizon
    if (aHaze > 0.003) {
        vec3 tone = mix(vec3(0.6, 0.56, 0.52), vec3(0.8, 0.66, 0.46), stored(HAZE_DUST));
        tone = mix(mix(tone, vec3(0.75, 0.5, 0.38), dusk * 0.6), tone * 0.25, night);
        float thick = (0.28 + 0.34 * smoothstep(0.9, 0.05, uv.y)) * (0.85 + 0.15 * fbm(vec2(p.x * 1.1 + drift.x * 0.02, uv.y * 2.0)));
        put(acc, tone, clamp(thick * aHaze, 0.0, 0.85));
    }
    // a tornado over the land at the horizon, in the storm's own light
    if (aTornado > 0.003) {
        vec3 shade = shownColour(SHADOW), litCloud = cloudLight;
        tornado(acc, p, uv, t, aspect, aTornado, litCloud, shade, drift.x);
        put(acc, mix(shade * 0.35, litCloud * 0.2, 0.3) + vec3(0.8, 0.85, 1.0) * glow * 0.06, horizonLand(p, uv) * aTornado);
    }
    // leaves in a strong wind, and the hail
    if (aHail > 0.003) hailstones(acc, add, p, uv, t, aHail, slant, lum, aspect);
    // frost on the glass
    if (frost > 0.003) iceOnGlass(acc, add, p, uv, aspect, frost, night, lum);
    vec3 light = vec3(0.8, 0.85, 1.0) * glow;
    // the weather laid over the clouds: its own light added, its cover veiling them
    vec3 sky = skyPicture.rgb;
    vec3 col = sky * (1.0 - acc.a) + acc.rgb + add + light;
    // a grain of up to one shade either way (two random values, the usual
    // way), which hides the steps between shades in a smooth sky
    return clamp(col, 0.0, 1.0) + (hash(frag) + hash(frag.yx + 71.3) - 1.0) / 255.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    if (PASSINDEX == 0) fragColor = drawState(ivec2(fragCoord));
    else if (PASSINDEX == 1) fragColor = drawClouds(fragCoord);
    else fragColor = vec4(drawPicture(fragCoord), 1.0);
}
