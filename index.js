const fs = require("fs");
const path = require("path");

const API_KEY = process.env.YOUTUBE_API_KEY;
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

const INTERVAL = 5 * 60 * 1000; // 5 minutos
const STATE_FILE = path.join(__dirname, "state.json");

if (!API_KEY || !DISCORD_WEBHOOK || !CHANNEL_ID) {
    console.error("Faltan variables de entorno.");
    process.exit(1);
}

let state = {
    subscribers: null,
    videos: {}
};

if (fs.existsSync(STATE_FILE)) {
    try {
        state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        console.log("No se pudo leer state.json. Se creará uno nuevo.");
    }
}

async function youtube(endpoint, params = {}) {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);

    params.key = API_KEY;

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    const response = await fetch(url);

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`YouTube API ${response.status}: ${text}`);
    }

    return response.json();
}

async function discord(content, embed = null) {
    const body = {
        content
    };

    if (embed) {
        body.embeds = [embed];
    }

    const response = await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        console.error(
            "Error enviando a Discord:",
            response.status,
            await response.text()
        );
    }
}

async function getChannel() {
    const data = await youtube("channels", {
        part: "statistics,contentDetails,snippet",
        id: CHANNEL_ID
    });

    if (!data.items || data.items.length === 0) {
        throw new Error("No se encontró el canal.");
    }

    return data.items[0];
}

async function getLatestVideos(uploadsPlaylistId) {
    const data = await youtube("playlistItems", {
        part: "snippet,contentDetails",
        playlistId: uploadsPlaylistId,
        maxResults: 20
    });

    return data.items || [];
}

async function getVideoStats(videoIds) {
    if (videoIds.length === 0) return [];

    const data = await youtube("videos", {
        part: "snippet,statistics",
        id: videoIds.join(",")
    });

    return data.items || [];
}

async function check() {
    try {
        console.log("Comprobando YouTube...");

        const channel = await getChannel();

        const statistics = channel.statistics;
        const subscriberCount =
            Number(statistics.subscriberCount || 0);

        // =========================
        // SUSCRIPTORES
        // =========================

        if (state.subscribers === null) {
            state.subscribers = subscriberCount;
        } else if (subscriberCount !== state.subscribers) {

            const difference =
                subscriberCount - state.subscribers;

            const sign = difference > 0 ? "+" : "";

            await discord(
                "",
                {
                    title: "👤 Suscriptores de YouTube",
                    description:
                        difference > 0
                            ? `¡Tu canal ha ganado suscriptores!`
                            : `El contador de suscriptores ha cambiado.`,
                    fields: [
                        {
                            name: "Anterior",
                            value: state.subscribers.toLocaleString("es-ES"),
                            inline: true
                        },
                        {
                            name: "Ahora",
                            value: subscriberCount.toLocaleString("es-ES"),
                            inline: true
                        },
                        {
                            name: "Cambio",
                            value: `${sign}${difference}`,
                            inline: true
                        }
                    ],
                    url: `https://www.youtube.com/channel/${CHANNEL_ID}`
                }
            );

            state.subscribers = subscriberCount;
        }

        // =========================
        // VÍDEOS
        // =========================

        const uploads =
            channel.contentDetails.relatedPlaylists.uploads;

        const videos = await getLatestVideos(uploads);

        const videoIds = videos.map(
            video => video.contentDetails.videoId
        );

        const stats = await getVideoStats(videoIds);

        for (const video of stats) {

            const id = video.id;
            const title = video.snippet.title;

            const likes =
                Number(video.statistics.likeCount || 0);

            const views =
                Number(video.statistics.viewCount || 0);

            const comments =
                Number(video.statistics.commentCount || 0);

            const url =
                `https://www.youtube.com/watch?v=${id}`;

            // =========================
            // VÍDEO NUEVO
            // =========================

            if (!state.videos[id]) {

                state.videos[id] = {
                    likes,
                    views,
                    comments,
                    title
                };

                await discord(
                    "",
                    {
                        title: "🆕 Nuevo vídeo en YouTube",
                        description: `**${title}**`,
                        fields: [
                            {
                                name: "👍 Likes",
                                value: likes.toLocaleString("es-ES"),
                                inline: true
                            },
                            {
                                name: "👀 Visitas",
                                value: views.toLocaleString("es-ES"),
                                inline: true
                            }
                        ],
                        url,
                        timestamp: new Date().toISOString()
                    }
                );

                continue;
            }

            const old = state.videos[id];

            // =========================
            // LIKES
            // =========================

            if (likes > old.likes) {

                const difference = likes - old.likes;

                await discord(
                    "",
                    {
                        title: "👍 ¡Nuevo like!",
                        description: `**${title}**`,
                        fields: [
                            {
                                name: "Likes anteriores",
                                value: old.likes.toLocaleString("es-ES"),
                                inline: true
                            },
                            {
                                name: "Likes ahora",
                                value: likes.toLocaleString("es-ES"),
                                inline: true
                            },
                            {
                                name: "Nuevos likes",
                                value: `+${difference}`,
                                inline: true
                            }
                        ],
                        url
                    }
                );
            }

            // =========================
            // VISITAS
            // =========================

            if (views > old.views) {

                const difference = views - old.views;

                await discord(
                    "",
                    {
                        title: "👀 Nuevas visitas",
                        description: `**${title}**`,
                        fields: [
                            {
                                name: "Visitas anteriores",
                                value: old.views.toLocaleString("es-ES"),
                                inline: true
                            },
                            {
                                name: "Visitas ahora",
                                value: views.toLocaleString("es-ES"),
                                inline: true
                            },
                            {
                                name: "Nuevas visitas",
                                value: `+${difference.toLocaleString("es-ES")}`,
                                inline: true
                            }
                        ],
                        url
                    }
                );
            }

            // Actualizar estado
            state.videos[id] = {
                likes,
                views,
                comments,
                title
            };
        }

        fs.writeFileSync(
            STATE_FILE,
            JSON.stringify(state, null, 2)
        );

        console.log(
            `[${new Date().toLocaleString("es-ES")}] OK`
        );

    } catch (error) {
        console.error("ERROR:", error.message);
    }
}

check();

setInterval(check, INTERVAL);
