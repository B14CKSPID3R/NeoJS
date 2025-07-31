plugins {
    id("java")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation("net.portswigger.burp.extensions:montoya-api:2025.5")
    implementation("org.jsoup:jsoup:1.16.1")
    implementation("org.json:json:20240303")
    implementation("com.fifesoft:rsyntaxtextarea:3.3.4")
    implementation("com.google.code.gson:gson:2.10.1")
}

tasks.withType<JavaCompile> {
    sourceCompatibility = "21"
    targetCompatibility = "21"
    options.encoding = "UTF-8"
}

tasks.jar {
    duplicatesStrategy = DuplicatesStrategy.EXCLUDE
    from(configurations.runtimeClasspath.get().filter { it.isDirectory })
    from(configurations.runtimeClasspath.get().filterNot { it.isDirectory }.map { zipTree(it) })
}
