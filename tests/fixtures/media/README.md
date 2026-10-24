# Synthetic media fixtures

These tiny assets contain only a generated sine tone or solid blue frames. They
contain no user, production or third-party content. They exercise actual local
MediaInfo WASM parsing and real local Supabase Storage HTTP flows in CI.

Generated with FFmpeg (test data generation only; the application does not call
an installed FFmpeg binary):

```sh
ffmpeg -f lavfi -i sine=frequency=440:duration=0.25 -ac 1 -c:a libmp3lame -b:a 32k tone.mp3
ffmpeg -f lavfi -i sine=frequency=440:duration=0.25 -ac 1 -c:a aac -b:a 32k tone.m4a
ffmpeg -f lavfi -i sine=frequency=440:duration=0.25 -ac 1 -c:a libopus -b:a 16k tone.webm
ffmpeg -f lavfi -i color=c=blue:s=32x24:r=10:d=0.3 -c:v libx264 -pix_fmt yuv420p clip.mp4
ffmpeg -f lavfi -i color=c=blue:s=32x24:r=10:d=0.3 -c:v libvpx-vp9 clip.webm
```

Image tests generate small raster inputs with the application's pinned Sharp
dependency. Malformed-content tests mutate only these synthetic bytes.

`long-tone.mp3` is a 90-second generated mono sine tone used only to verify real
browser playback beyond a 60-second signed URL lifetime. The browser seeks and
plays actual native audio; test clock control accelerates UI renewal timers, not
the stored duration or server authorization. It contains no speech or user data.

```sh
ffmpeg -f lavfi -i sine=frequency=440:duration=90 -ac 1 -c:a libmp3lame -b:a 32k long-tone.mp3
```
