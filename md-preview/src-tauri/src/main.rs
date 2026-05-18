#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_PATH: &str = "C:\\data\\md-preview-config.json";

#[derive(Serialize, Deserialize, Default)]
struct AppConfig {
    #[serde(default)]
    win_width: Option<f64>,
    #[serde(default)]
    win_height: Option<f64>,
}

impl AppConfig {
    fn load() -> Self {
        fs::read_to_string(CONFIG_PATH)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(&self) {
        if let Ok(json) = serde_json::to_string(self) {
            let _ = fs::write(CONFIG_PATH, json);
        }
    }
}

#[tauri::command]
async fn set_always_on_top(app: tauri::AppHandle, on_top: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    window
        .set_always_on_top(on_top)
        .map_err(|e| format!("set_always_on_top failed: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn set_window_size(app: tauri::AppHandle, width: f64, height: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    window
        .set_size(tao::dpi::PhysicalSize { width, height })
        .map_err(|e| format!("set_window_size failed: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn save_window_size(width: f64, height: f64) -> Result<(), String> {
    let mut config = AppConfig::load();
    config.win_width = Some(width);
    config.win_height = Some(height);
    config.save();
    Ok(())
}

#[tauri::command]
async fn fetch_markdown(host: String, port: String, etag: String) -> Result<FetchResponse, String> {
    let client = reqwest::Client::builder()
        .no_gzip()
        .build()
        .map_err(|e| e.to_string())?;

    let mut result = try_fetch(&client, &host, &port, &etag, "/raw").await?;
    if result.status == 404 {
        result = try_fetch(&client, &host, &port, &etag, "/").await?;
    }

    Ok(result)
}

async fn try_fetch(
    client: &reqwest::Client,
    host: &str,
    port: &str,
    etag: &str,
    path: &str,
) -> Result<FetchResponse, String> {
    let url = if path == "/raw" {
        format!("http://{}:{}/raw", host, port)
    } else {
        format!("http://{}:{}/", host, port)
    };

    let mut req = client.get(&url);
    if !etag.is_empty() {
        req = req.header("If-None-Match", etag);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();

    if status == 304 {
        return Ok(FetchResponse { status: 304, body: String::new(), etag: String::new() });
    }

    let new_etag = resp
        .headers()
        .get("ETag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = resp.text().await.map_err(|e| e.to_string())?;

    Ok(FetchResponse { status, body, etag: new_etag })
}

#[derive(serde::Serialize, serde::Deserialize)]
struct FetchResponse {
    status: u16,
    body: String,
    etag: String,
}

#[tauri::command]
async fn fetch_image(host: String, port: String, path: String) -> Result<ImageResponse, String> {
    let url = format!("http://{}:{}/file/{}", host, port, path);
    let client = reqwest::Client::builder()
        .no_gzip()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    if status != 200 {
        return Ok(ImageResponse { status, mime_type: "application/octet-stream".to_string(), data: String::new() });
    }
    let mime_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    let data = base64::encode(&bytes);
    Ok(ImageResponse { status, mime_type, data })
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ImageResponse {
    status: u16,
    mime_type: String,
    data: String,
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let config = AppConfig::load();
            if let Some(window) = app.get_webview_window("main") {
                if let (Some(w), Some(h)) = (config.win_width, config.win_height) {
                    let _ = window.set_size(tao::dpi::PhysicalSize { width: w, height: h });
                }
                let _ = window.set_always_on_top(true);
                let _ = window.show();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_always_on_top,
            set_window_size,
            save_window_size,
            fetch_markdown,
            fetch_image,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
