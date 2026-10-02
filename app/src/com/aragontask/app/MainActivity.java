package com.aragontask.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

public class MainActivity extends Activity {

    private WebView web;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#F0EEE6"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);

        try {
            s.setForceDark(WebSettings.FORCE_DARK_OFF);
        } catch (Throwable ignored) {
        }

        web.addJavascriptInterface(new NetBridge(), "AndroidNet");
        web.setWebViewClient(new WebViewClient());
        web.loadUrl("file:///android_asset/index.html");
    }

    private void replyJs(final String js) {
        web.post(new Runnable() {
            public void run() {
                try {
                    web.evaluateJavascript(js, null);
                } catch (Throwable ignored) {
                }
            }
        });
    }

    /** Native HTTP bridge: plain request + SSE streaming + open external urls. */
    private class NetBridge {

        @JavascriptInterface
        public void request(final String method, final String url, final String headersJson,
                            final String body, final String cbId) {
            new Thread(new Runnable() {
                public void run() {
                    int status = -1;
                    String resp = "";
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setRequestMethod(method);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(120000);
                        applyHeaders(c, headersJson);
                        if (body != null && body.length() > 0) {
                            c.setDoOutput(true);
                            byte[] b = body.getBytes(StandardCharsets.UTF_8);
                            c.setFixedLengthStreamingMode(b.length);
                            OutputStream o = c.getOutputStream();
                            o.write(b);
                            o.close();
                        }
                        status = c.getResponseCode();
                        InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[8192];
                        int n;
                        while (is != null && (n = is.read(buf)) > 0) bo.write(buf, 0, n);
                        resp = new String(bo.toByteArray(), StandardCharsets.UTF_8);
                    } catch (Exception e) {
                        resp = "{\"error\":\"" + safe(e) + "\"}";
                        status = 0;
                    }
                    final int st = status;
                    final String rp = resp;
                    replyJs("window.__netDone('" + cbId + "'," + st + "," +
                            (rp == null || rp.length() == 0 ? "''" : JSONObject.quote(rp)) + ")");
                }
            }).start();
        }

        /** Streaming variant: forwards each SSE line via window.__netChunk as it arrives. */
        @JavascriptInterface
        public void stream(final String method, final String url, final String headersJson,
                           final String body, final String cbId) {
            new Thread(new Runnable() {
                public void run() {
                    int status = -1;
                    StringBuilder all = new StringBuilder();
                    try {
                        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                        c.setRequestMethod(method);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(120000);
                        applyHeaders(c, headersJson);
                        if (body != null && body.length() > 0) {
                            c.setDoOutput(true);
                            byte[] b = body.getBytes(StandardCharsets.UTF_8);
                            c.setFixedLengthStreamingMode(b.length);
                            OutputStream o = c.getOutputStream();
                            o.write(b);
                            o.close();
                        }
                        status = c.getResponseCode();
                        InputStream is = status >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (is != null) {
                            BufferedReader r = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8));
                            String line;
                            StringBuilder buf = new StringBuilder();
                            long lastFlush = System.currentTimeMillis();
                            int bufLines = 0;
                            while ((line = r.readLine()) != null) {
                                final String chunk = line + "\n";
                                all.append(chunk);
                                buf.append(chunk);
                                bufLines++;
                                long now = System.currentTimeMillis();
                                if (bufLines >= 24 || now - lastFlush >= 40) {
                                    final String batch = buf.toString();
                                    replyJs("window.__netChunk('" + cbId + "'," + JSONObject.quote(batch) + ")");
                                    buf.setLength(0);
                                    bufLines = 0;
                                    lastFlush = now;
                                }
                            }
                            if (buf.length() > 0) {
                                final String batch = buf.toString();
                                replyJs("window.__netChunk('" + cbId + "'," + JSONObject.quote(batch) + ")");
                            }
                        }
                    } catch (Exception e) {
                        status = 0;
                        all.insert(0, "{\"error\":\"" + safe(e) + "\"}");
                    }
                    final int st = status;
                    final String rp = all.toString();
                    replyJs("window.__netDone('" + cbId + "'," + st + "," +
                            (rp == null || rp.length() == 0 ? "''" : JSONObject.quote(rp)) + ")");
                }
            }).start();
        }

        /** Exit the app (called after hardware back resolves to root). */
        @JavascriptInterface
        public void exitApp() {
            runOnUiThread(new Runnable() {
                public void run() {
                    finish();
                }
            });
        }

        /** Open a url with the system browser. */
        @JavascriptInterface
        public void openUrl(final String u) {
            try {
                final Uri uri = Uri.parse(u);
                runOnUiThread(new Runnable() {
                    public void run() {
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        } catch (Throwable ignored) {
                        }
                    }
                });
            } catch (Throwable ignored) {
            }
        }

        private void applyHeaders(HttpURLConnection c, String headersJson) throws Exception {
            JSONObject hs = new JSONObject(headersJson);
            Iterator<String> it = hs.keys();
            while (it.hasNext()) {
                String k = it.next();
                c.setRequestProperty(k, hs.getString(k));
            }
        }

        private String safe(Exception e) {
            return String.valueOf(e.getMessage()).replace("\\", "/").replace("\"", "'");
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null) {
            /* delegate to the page: close sheet > back to hub > exit */
            web.evaluateJavascript("window.__back && window.__back()", null);
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
        }
        super.onDestroy();
    }
}
