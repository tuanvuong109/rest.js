const _ = require('lodash')
const writeFileSync = require('fs').writeFileSync

const NEW_ROUTES = require('@octokit/routes')
const CURRENT_ROUTES = require('../lib/routes')

function sortRoutesByKeys (routes) {
  Object.keys(routes).forEach(scope => {
    routes[scope] = sortByKeys(routes[scope])

    Object.keys(routes[scope]).forEach(method => {
      routes[scope][method] = sortByKeys(routes[scope][method])
      routes[scope][method].params = sortByKeys(routes[scope][method].params)

      Object.keys(routes[scope][method].params).forEach(paramName => {
        routes[scope][method].params[paramName] = sortByKeys(routes[scope][method].params[paramName])
      })
    })
  })

  return sortByKeys(routes)
}

function sortByKeys (object) {
  return _(object).toPairs().sortBy(0).fromPairs().value()
}

// // minimal script to adapt the existing routes file
// Object.keys(CURRENT_ROUTES).forEach((scope) => {
//   Object.keys(CURRENT_ROUTES[scope]).forEach(methodName => {
//     const endpoint = CURRENT_ROUTES[scope][methodName]
//     delete endpoint.description
//
//     Object.keys(endpoint.params).forEach(name => {
//       delete endpoint.params[name].description
//       delete endpoint.params[name].default
//     })
//   })
// })
// writeFileSync('lib/routes.json', JSON.stringify(sortRoutesByKeys(CURRENT_ROUTES), null, 2) + '\n')

const MISC_SCOPES = [
  'codesOfConduct',
  // 'emojis', https://github.com/octokit/routes/issues/50
  'gitignore',
  'licenses',
  'markdown',
  'rateLimit'
]

NEW_ROUTES['misc'] = [].concat(...MISC_SCOPES.map(scope => NEW_ROUTES[scope]))
NEW_ROUTES['orgs'] = NEW_ROUTES['orgs'].concat(NEW_ROUTES['teams'])

// move around some methods ¯\_(ツ)_/¯
const ORG_USER_PATHS = [
  '/user/orgs',
  '/user/memberships/orgs',
  '/user/memberships/orgs/:org',
  '/user/teams'
]
const REPOS_USER_PATHS = [
  '/user/repository_invitations',
  '/user/repository_invitations/:invitation_id'
]
const APPS_USER_PATHS = [
  '/user/installations',
  '/user/installations/:installation_id/repositories',
  '/user/installations/:installation_id/repositories/:repository_id',
  '/user/marketplace_purchases',
  '/user/marketplace_purchases/stubbed'
]
NEW_ROUTES['users'].push(...NEW_ROUTES['orgs'].filter(endpoint => ORG_USER_PATHS.includes(endpoint.path)))
NEW_ROUTES['users'].push(...NEW_ROUTES['repos'].filter(endpoint => REPOS_USER_PATHS.includes(endpoint.path)))
NEW_ROUTES['users'].push(...NEW_ROUTES['apps'].filter(endpoint => APPS_USER_PATHS.includes(endpoint.path)))

// map scopes from @octokit/routes to what we currently have in lib/routes.json
const mapScopes = {
  activity: 'activity',
  apps: 'apps',
  codesOfConduct: false,
  gists: 'gists',
  git: 'gitdata',
  gitignore: false,
  issues: 'issues',
  licenses: false,
  markdown: false,
  migration: 'migrations',
  misc: 'misc',
  oauthAuthorizations: 'authorization',
  orgs: 'orgs',
  projects: 'projects',
  pulls: 'pullRequests',
  rateLimit: false,
  reactions: 'reactions',
  repos: 'repos',
  scim: false,
  search: 'search',
  teams: false,
  users: 'users'
}

const newRoutes = {}
const newDocRoutes = {}
Object.keys(NEW_ROUTES).forEach(scope => {
  const currentScopeName = mapScopes[scope]

  if (!currentScopeName) {
    return
  }

  NEW_ROUTES[currentScopeName] = NEW_ROUTES[scope]

  newRoutes[currentScopeName] = {}
  newDocRoutes[currentScopeName] = {}
})

// don’t break the deprecated "integrations" scope
NEW_ROUTES.integrations = NEW_ROUTES.apps.map(route => {
  return Object.assign({
    deprecated: '`integrations` has been renamed to `apps`'
  }, route)
})

// mutate the new routes to what we have today
Object.keys(CURRENT_ROUTES).sort().forEach(scope => {
  // enterprise is not part of @octokit/routes, we’ll leave it as-is.
  if (scope === 'enterprise') {
    return
  }

  Object.keys(CURRENT_ROUTES[scope]).map(methodName => {
    const currentEndpoint = CURRENT_ROUTES[scope][methodName]

    if (currentEndpoint.method === 'GET' && currentEndpoint.url === '/repos/:owner/:repo/git/refs') {
      console.log('Ignoring custom override for GET /repos/:owner/:repo/git/refs (https://github.com/octokit/routes/commit/b7a9800)')
      return
    }

    if (currentEndpoint.url === '/repos/:owner/:repo/git/refs/tags') {
      console.log('Ignoring endpoint for getTags()')
      return
    }

    if (currentEndpoint.deprecated) {
      console.log(`No endpoint found for deprecated ${currentEndpoint.method} ${currentEndpoint.url}, leaving route as is.`)
      return
    }

    // TODO: https://github.com/octokit/routes/issues/50
    if (['getEmojis', 'getMeta'].includes(methodName)) {
      return
    }

    if ([
      '/users/:username/suspended',
      '/users/:username/site_admin'
    ].includes(currentEndpoint.url)) {
      console.log('Ignoring endpoints belonging to enterprise admin')
      return
    }

    const newEndpoint = NEW_ROUTES[mapScopes[scope] || scope].find(newEndpoint => {
      // project_id, card_id, column_id => just id
      if (/:project_id/.test(newEndpoint.path)) {
        newEndpoint.path = newEndpoint.path.replace(/:project_id/, ':id')
        newEndpoint.params.forEach(param => {
          if (param.name === 'project_id') {
            param.name = 'id'
          }
        })
      }
      if (/:card_id/.test(newEndpoint.path)) {
        newEndpoint.path = newEndpoint.path.replace(/:card_id/, ':id')
        newEndpoint.params.forEach(param => {
          if (param.name === 'card_id') {
            param.name = 'id'
          }
        })
      }
      if (/:column_id/.test(newEndpoint.path)) {
        newEndpoint.path = newEndpoint.path.replace(/:column_id/, ':id')
        newEndpoint.params.forEach(param => {
          if (param.name === 'column_id') {
            param.name = 'id'
          }
        })
      }

      return newEndpoint.method === currentEndpoint.method && newEndpoint.path === currentEndpoint.url
    })

    if (!newEndpoint) {
      throw new Error(`No endpoint found for ${currentEndpoint.method} ${currentEndpoint.url} (scope: ${scope}, ${JSON.stringify(currentEndpoint, null, 2)})`)
    }

    // reduce from params array to params object
    currentEndpoint.params = newEndpoint.params.reduce((map, param) => {
      map[param.name] = _.clone(param)
      delete map[param.name].name
      return map
    }, {})

    currentEndpoint.url = newEndpoint.path
    // we no longer need description, we can generate docs from @octokit/routes
    delete currentEndpoint.description
    Object.keys(currentEndpoint.params).forEach(name => {
      delete currentEndpoint.params[name].description
      delete currentEndpoint.params[name].default
      if (currentEndpoint.params[name].required === false) {
        delete currentEndpoint.params[name].required
      }
    })

    newRoutes[scope][methodName] = currentEndpoint
    newDocRoutes[scope][methodName] = newEndpoint
  })
})

// don’t break the "enterprise" scope, it’s not part of @octokit/routes at this point
newRoutes.enterprise = CURRENT_ROUTES.enterprise
newRoutes.users.promote = CURRENT_ROUTES.users.promote
newRoutes.users.demote = CURRENT_ROUTES.users.demote
newRoutes.users.suspend = CURRENT_ROUTES.users.suspend
newRoutes.users.unsuspend = CURRENT_ROUTES.users.unsuspend

// const {diffString} = require('json-diff')
// const {get} = require('lodash')
// const CHECK = 'activity'
//
// console.log(diffString(
//   get(CURRENT_ROUTES, CHECK),
//   get(newRoutes, CHECK)
// ))

writeFileSync('lib/routes.json', JSON.stringify(sortRoutesByKeys(newRoutes), null, 2))
writeFileSync('scripts/routes-for-api-docs.json', JSON.stringify(sortRoutesByKeys(newDocRoutes), null, 2))
