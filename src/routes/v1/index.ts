import express from 'express';
import config from '../../config/config';
import docsRoute from './docs.route';
import healthCheckRoute from './health.check.route'
import masterRoutes from './master.route'
import userRoutes from './user.route'
// import captchaRoutes from './captcha.route'
import LeadRoutes from './Lead.route';
import PropertyRoutes from './property.route'
import LeadAssignRoutes from './leadAssign.route'
import LeadFollowUpRoutes from './leadFollowUp.route'
import BookingRoutes from './bookingDetails.route'
import SidebarRoutes from './sidebar.route'
import TeamMemberRoutes from './teamMember.route'
import AccessRoleRoutes from './accessRole.route'
import DynamicModuleRoutes from './dynamicModule.route'

const router = express.Router();


const defaultRoutes = [
  {
    path: '/',
    route: healthCheckRoute
  },
  {
    path: '/mdm-master',
    route: masterRoutes
  },
  {
    path: '/user',
    route: userRoutes
  },
  // {
  //   path: '/captcha',
  //   route: captchaRoutes
  // }
  {
    path: '/getLead',
    route: LeadRoutes

  },
  {
    path: '/property',
    route: PropertyRoutes

  },
  {
    path: '/lead-assign',
    route: LeadAssignRoutes

  },
  {
    path: '/lead-followup',
    route: LeadFollowUpRoutes

  },
  {
    path: '/booking',
    route: BookingRoutes

  },
  {
    path: '/sidebar-menu',
    route: SidebarRoutes

  },
  {
    path: '/team-members',
    route: TeamMemberRoutes

  },
  {
    path: '/role-access',
    route: AccessRoleRoutes

  },
  {
    path: '/modules',
    route: DynamicModuleRoutes

  },
];

const devRoutes = [
  // routes available only in development mode
  {
    path: '/docs',
    route: docsRoute
  }
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (config.env === 'development') {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

export default router;
