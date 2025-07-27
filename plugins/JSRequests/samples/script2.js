// === DOM-based vulnerability ===
        // Unsafe usage of location.hash directly in DOM without sanitization
        var userInput = location.hash.substring(1);
        // Vulnerable to XSS if attacker sets URL like: http://site/#<script>alert('XSS')
        document.getElementById('output').innerHTML = "User input: " + userInput;

        // === Obfuscated fetch request ===
        (function(){
            var u = "ht" + "tp" + "s://" + "ex" + "ample.com/api/data";
            var h = {};
            h["Au" + "th"] = "Bea" + "rer " + "abc123token";

            fetch(u, {
                method: 'GET',
                headers: h
            })
            .then(function(res){ return res.json(); })
            .then(function(data){
                console.log("Fetch response:", data);
            })
            .catch(function(e){ console.error("Fetch error:", e); });
        })();

        // === Obfuscated XMLHttpRequest ===
        (function(){
            var xhr = new XMLHttpRequest();
            var url = "ht" + "tp" + "://example.com/api/xhr";
            xhr.open("POST", url, true);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.onreadystatechange = function() {
                if(xhr.readyState === 4 && xhr.status === 200) {
                    console.log("XHR response:", xhr.responseText);
                }
            };
            var payload = '{"data":"' + String.fromCharCode(116, 101, 115, 116) + '"}'; // "test"
            xhr.send(payload);
        })();

        // === Obfuscated axios request ===
        (function(){
            var ax = window['ax' + 'ios'];
            var baseURL = "https://" + "example.com/api/axios";
            ax.post(baseURL, {message: "Obfuscated axios request"})
                .then(function(response) {
                    console.log("Axios response:", response.data);
                })
                .catch(function(error) {
                    console.error("Axios error:", error);
                });
        })();