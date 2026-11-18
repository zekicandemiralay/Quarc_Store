package com.quarc.store;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Minimal blocking HTTP for native code paths that run without the WebView. Call off the main thread. */
final class Http {
    private Http() {}

    static final class Response {
        final int code;
        final String body;

        Response(int code, String body) {
            this.code = code;
            this.body = body;
        }
    }

    static Response get(String url) throws IOException {
        return send("GET", url, null, null);
    }

    static Response postJson(String url, String json, String authorization) throws IOException {
        return send("POST", url, json, authorization);
    }

    private static Response send(String method, String url, String json, String authorization) throws IOException {
        if (!url.startsWith("https://")) throw new IOException("Refusing non-HTTPS URL");
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setRequestMethod(method);
            con.setConnectTimeout(10000);
            con.setReadTimeout(15000);
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty("User-Agent", "QuarcStore-Android");
            if (authorization != null) con.setRequestProperty("Authorization", authorization);
            if (json != null) {
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
                con.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = con.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int code = con.getResponseCode();
            InputStream in = code >= 400 ? con.getErrorStream() : con.getInputStream();
            return new Response(code, in == null ? "" : readAll(in));
        } finally {
            con.disconnect();
        }
    }

    private static String readAll(InputStream in) throws IOException {
        try (InputStream is = in) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = is.read(chunk)) > 0) buf.write(chunk, 0, n);
            return buf.toString("UTF-8");
        }
    }
}
