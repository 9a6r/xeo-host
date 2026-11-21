module.exports = {
  apps: [
    {
      name: "xeo-host",
      script: "src/index.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "4G",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
