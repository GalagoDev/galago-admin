module.exports = {
  apps: [
    {
      name: 'store-admin',
      cwd: '/var/www/store-admin',
      script: 'npm',
      args: 'start -- --hostname 0.0.0.0 --port 3000',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
    },
    {
      name: 'store-admin-orders-bot',
      cwd: '/var/www/store-admin',
      script: 'npm',
      args: 'run bot:orders',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
