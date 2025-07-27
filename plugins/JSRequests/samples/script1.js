// Enhanced test file with various HTTP request patterns
// This file contains multiple types of HTTP requests for testing the analyzer

// URL variables (analyzer can detect these)
var baseUrl = "https://api.example.com";
const endpoint1 = "/api/data1";
let fullUrl = baseUrl + endpoint1 + "?query=test";

if (false) {
  fetch("https://example.com/api/hidden?query=hidden", {
  method: "PUT",
  headers: {
    "Authorization": "Bearer hidden",
    "Accept": "application/json"
  }
}).then(response => response.json());
}

// ---- 1. Native Fetch API ----
fetch("https://example.com/api/data1?query=test", {
  method: "GET",
  headers: {
    "Authorization": "Bearer token123",
    "Accept": "application/json"
  }
}).then(response => response.json());

// Fetch with variable URL
fetch(fullUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer token456"
  },
  body: JSON.stringify({ data: "test" })
});

// ---- 2. XMLHttpRequest (XHR) ----
const xhr = new XMLHttpRequest();
xhr.open("GET", "https://example.com/api/data2?query=test");
xhr.setRequestHeader("Authorization", "Bearer token123");
xhr.setRequestHeader("Accept", "application/json");
xhr.onreadystatechange = function() {
  if (xhr.readyState === 4) {
    console.log(xhr.responseText);
  }
};
xhr.send();

// Another XHR example
const xhr2 = new XMLHttpRequest();
xhr2.open("POST", baseUrl + "/api/submit");
xhr2.setRequestHeader("Content-Type", "application/json");
xhr2.send(JSON.stringify({ message: "hello" }));

// ---- 3. Axios (Various patterns) ----
// Basic axios call
axios.get("https://example.com/api/data3", {
  headers: {
    "Authorization": "Bearer token123",
    "Accept": "application/json"
  }
});

// Axios POST with data
axios.post("https://example.com/api/data4", {
  name: "test",
  value: "data"
}, {
  headers: {
    "Authorization": "Bearer token789",
    "Content-Type": "application/json"
  }
});

// Axios with config object
axios({
  method: 'put',
  url: 'https://example.com/api/data5',
  data: {
    id: 123,
    update: "modified"
  },
  headers: {
    'Authorization': 'Bearer token999'
  }
});

// ---- 4. jQuery AJAX (if jQuery is available) ----
$.ajax({
  url: "https://example.com/api/jquery1",
  method: "GET",
  headers: {
    "Authorization": "Bearer jqueryToken"
  },
  success: function(data) {
    console.log(data);
  }
});

$.get("https://example.com/api/jquery2?param=value");

$.post("https://example.com/api/jquery3", {
  data: "payload"
});

// ---- 5. Other HTTP libraries ----
// Superagent style (if available)
request
  .get('https://example.com/api/request1')
  .set('Authorization', 'Bearer requestToken')
  .end();

// ---- 6. WebSocket connection ----
const ws = new WebSocket("wss://example.com/websocket");

// ---- 7. Dynamic URL construction ----
const protocol = "https://";
const domain = "api.dynamic.com";
const path = "/v1/endpoint";
const dynamicUrl = protocol + domain + path;

fetch(dynamicUrl, {
  method: "GET",
  headers: {
    "API-Key": "dynamic123"
  }
});

// ---- 8. Base64 encoded URLs (obfuscation test) ----
const encodedUrl = btoa("https://hidden.example.com/secret");
const decodedUrl = atob(encodedUrl);
fetch(decodedUrl);

// ---- 9. String concatenation patterns ----
const apiVersion = "v2";
const resource = "users";
const concatenatedUrl = "https://api.service.com/" + apiVersion + "/" + resource;
axios.get(concatenatedUrl);

// ---- 10. Template literals ----
const userId = 123;
const templateUrl = `https://api.users.com/user/${userId}/profile`;
fetch(templateUrl);

// ---- 11. Potential security issues (for vulnerability detection) ----
// XSS potential
const params = new URLSearchParams(window.location.search);
document.getElementById("content").innerHTML = params.get("name");

// Another XSS potential
document.write("<div>Dynamic content</div>");