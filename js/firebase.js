// ============================================================
//  填入你的 Firebase 設定
//  步驟：firebase.google.com → 建立專案 → 新增網頁應用程式
//        → 複製 firebaseConfig 物件貼到下方
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyCsM7GUdQhAsaxJedoIp2l7SMi2EAj8SL4",
  authDomain: "poker-chip-calculator.firebaseapp.com",
  databaseURL: "https://poker-chip-calculator-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "poker-chip-calculator",
  storageBucket: "poker-chip-calculator.firebasestorage.app",
  messagingSenderId: "47302069321",
  appId: "1:47302069321:web:1e759f76d9c3f2c10f0398"
};

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, set, get, update, onValue, runTransaction, push, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

let app, db;

export function initFirebase() {
  app = initializeApp(firebaseConfig);
  db = getDatabase(app);
}

export function roomRef(code)           { return ref(db, `rooms/${code}`); }
export function roomStatusRef(code)     { return ref(db, `rooms/${code}/status`); }
export function roomConfigRef(code)     { return ref(db, `rooms/${code}/config`); }
export function playersRef(code)        { return ref(db, `rooms/${code}/players`); }
export function playerRef(code, idx)    { return ref(db, `rooms/${code}/players/${idx}`); }
export function handRef(code)           { return ref(db, `rooms/${code}/hand`); }
export function seatRef(code, idx)      { return ref(db, `rooms/${code}/hand/seats/${idx}`); }
export function historyRef(code)        { return ref(db, `rooms/${code}/history`); }

export async function dbSet(r, val)     { await set(r, val); }
export async function dbGet(r)          { const s = await get(r); return s.val(); }
export async function dbUpdate(r, val)  { await update(r, val); }
export function dbListen(r, cb)         { return onValue(r, snap => cb(snap.val())); }
export async function dbTransaction(r, fn) { return runTransaction(r, fn); }
export function dbPush(r, val)          { return push(r, val); }
export { serverTimestamp };
