const core = require('@actions/core');
const github = require("@actions/github");

const ghContext = github.context;
const ghRepo = ghContext.payload.repository;
const repoOwner = ghRepo.owner;

const gh = github.getOctokit(core.getInput('token'));
const args = { owner: repoOwner.login, repo: ghRepo.name };

const files = new Set();

async function getCommits() {
	const url = ghContext.payload.pull_request.commits_url;
    let commits = await gh.paginate(`GET ${url}`, args);
	return commits;
}

async function getCommit(commit) {
    args.ref = commit.id || commit.sha;
    return gh.rest.repos.getCommit(args);
}

async function processCommitData(commit) {
    if (!commit || !commit.data) {
        return;
    }

    commit.data.files.forEach(file => {
        files.add(file.filename);
    });
}

function getChangedFiles(process) {
    getCommits().then(commits => {
        Promise.all(commits.map(getCommit))
            .then(data => Promise.all(data.map(processCommitData)))
            .then(() => {
                process(files);
            })
            .catch(console.log);
    });
}

module.exports.getChangedFiles = getChangedFiles;
