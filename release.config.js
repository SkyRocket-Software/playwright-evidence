export default {
  branches: ['main'],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    ['@semantic-release/npm', { npmPublish: true, tarballDir: 'releases' }],
    ['@semantic-release/github', { assets: ['releases/*.tgz'] }],
  ],
};
