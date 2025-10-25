const socket = io();
let partnerId = null;

const pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:192.168.81.78:3478", 
      username: "testuser",
      credential: "testpass"
    }
  ]
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chat = document.getElementById("chat");
const msgBox = document.getElementById("msgBox");

async function startMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("❌ Camera/Mic not supported or blocked. Use HTTPS or allow permissions.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    localVideo.srcObject = stream;
    localVideo.muted = true;
    localVideo.play();

    pc.ontrack = (event) => {
      console.log("📡 Remote track received");
      remoteVideo.srcObject = event.streams[0];
      remoteVideo.onloadedmetadata = () => {
        remoteVideo.play().catch((err) => console.warn("⚠️ Autoplay blocked:", err));
      };
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && partnerId) {
        socket.emit("signal", { to: partnerId, data: { type: "ice", candidate: event.candidate } });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE State:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        console.warn("❌ ICE connection failed, retrying...");
      }
    };
  } catch (err) {
    console.error("getUserMedia failed:", err);
    alert("🎥 Failed to access camera/mic: " + err.message);
  }
}

/* ===== Socket Events ===== */
socket.on("connect", () => console.log("🟢 Connected:", socket.id));
socket.on("waiting", () => log("⌛ Waiting for a partner..."));

socket.on("paired", async ({ peerId }) => {
  partnerId = peerId;
  console.log("🎯 Matched with", partnerId);

  // only one peer should create the offer
  if (socket.id > partnerId) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: partnerId, data: { type: "offer", sdp: offer } });
  }
});

socket.on("signal", async ({ from, data }) => {
  partnerId = from;

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: from, data: { type: "answer", sdp: answer } });

  } else if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

  } else if (data.type === "ice" && data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (err) {
      console.error("❌ ICE add failed:", err);
    }
  }
});

/* ===== Chat & Disconnect ===== */
socket.on("message", ({ from, message }) => log(`👤 ${from}: ${message}`));
socket.on("partner_left", () => {
  log("⚠️ Partner disconnected");
  remoteVideo.srcObject = null;
  partnerId = null;
});

/* ===== Button Handlers ===== */
document.getElementById("startBtn").onclick = async () => {
  await startMedia();
  socket.emit("join_queue");
};

document.getElementById("nextBtn").onclick = () => {
  socket.emit("next");
  chat.innerHTML = "";
  remoteVideo.srcObject = null;
};

document.getElementById("sendBtn").onclick = () => {
  const text = msgBox.value.trim();
  if (text && partnerId) {
    socket.emit("message", { to: partnerId, message: text });
    log(`🧍 You: ${text}`);
    msgBox.value = "";
  }
};

/* ===== Utility ===== */
function log(msg) {
  chat.innerHTML += `<div>${msg}</div>`;
  chat.scrollTop = chat.scrollHeight;
}
