import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EmergencyHomeScreen } from '../features/citizen/screens/EmergencyHomeScreen';
import { CreateSOSScreen } from '../features/citizen/screens/CreateSOSScreen';
import { ProxySOSScreen } from '../features/citizen/screens/ProxySOSScreen';
import { MyRequestsScreen } from '../features/citizen/screens/MyRequestsScreen';
import { SOSTrackingScreen } from '../features/tracking/screens/SOSTrackingScreen';
import { DonationScreen } from '../features/donation/screens/DonationScreen';
import { NoticesScreen } from '../features/citizen/screens/NoticesScreen';
import { CampaignsScreen } from '../features/citizen/screens/CampaignsScreen';
import { LoginScreen } from '../features/auth/screens/LoginScreen';
import { RegisterScreen } from '../features/auth/screens/RegisterScreen';
import { ChangePasswordScreen } from '../features/auth/screens/ChangePasswordScreen';
import { TeamDashboardScreen } from '../features/volunteer/screens/TeamDashboardScreen';
import { MissionListScreen } from '../features/volunteer/screens/MissionListScreen';
import { MissionDetailScreen } from '../features/volunteer/screens/MissionDetailScreen';

export type RootStackParamList = {
  EmergencyHomeScreen: undefined;
  CreateSOSScreen: undefined;
  ProxySOSScreen: undefined;
  MyRequestsScreen: undefined;
  SOSTrackingScreen: { trackingCode?: string; trackingSecret?: string } | undefined;
  DonationScreen: undefined;
  NoticesScreen: undefined;
  CampaignsScreen: undefined;
  LoginScreen: undefined;
  RegisterScreen: undefined;
  ChangePasswordScreen: undefined;
  TeamDashboardScreen: undefined;
  MissionListScreen: undefined;
  MissionDetailScreen: { missionId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export const RootNavigator: React.FC = () => {
  return (
    <Stack.Navigator
      initialRouteName="EmergencyHomeScreen"
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
      }}
    >
      {/* Phân hệ Người dân & Khách */}
      <Stack.Screen name="EmergencyHomeScreen" component={EmergencyHomeScreen} />
      <Stack.Screen name="CreateSOSScreen" component={CreateSOSScreen} />
      <Stack.Screen name="ProxySOSScreen" component={ProxySOSScreen} />
      <Stack.Screen name="MyRequestsScreen" component={MyRequestsScreen} />
      <Stack.Screen name="SOSTrackingScreen" component={SOSTrackingScreen} />
      <Stack.Screen name="DonationScreen" component={DonationScreen} />
      <Stack.Screen name="NoticesScreen" component={NoticesScreen} />
      <Stack.Screen name="CampaignsScreen" component={CampaignsScreen} />

      {/* Phân hệ Tài khoản, Đội cứu hộ & Tình nguyện viên */}
      <Stack.Screen name="LoginScreen" component={LoginScreen} />
      <Stack.Screen name="RegisterScreen" component={RegisterScreen} />
      <Stack.Screen name="ChangePasswordScreen" component={ChangePasswordScreen} />
      <Stack.Screen name="TeamDashboardScreen" component={TeamDashboardScreen} />
      <Stack.Screen name="MissionListScreen" component={MissionListScreen} />
      <Stack.Screen name="MissionDetailScreen" component={MissionDetailScreen} />
    </Stack.Navigator>
  );
};
