import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AlertTriangle } from 'lucide-react-native';
import { THEME } from '../../constants/theme';

interface SOSButtonProps {
  onPress: () => void;
  title?: string;
  subTitle?: string;
}

export const SOSButton: React.FC<SOSButtonProps> = ({
  onPress,
  title = 'GỬI YÊU CẦU CỨU NẠN',
  subTitle = 'CHẠM ĐỂ BÁO CỨU HỘ KHẨN CẤP',
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(opacityAnim, {
            toValue: 0.1,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(opacityAnim, {
            toValue: 0.6,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim, opacityAnim]);

  const handlePress = () => {
    // Rung haptic mạnh khi ấn nút khẩn cấp
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onPress();
  };

  return (
    <View style={styles.container}>
      {/* Vòng sóng radar lan tỏa phía sau */}
      <Animated.View
        style={[
          styles.radarWave,
          {
            transform: [{ scale: pulseAnim }],
            opacity: opacityAnim,
          },
        ]}
      />

      {/* Nút bấm SOS trung tâm */}
      <TouchableOpacity
        style={styles.sosButton}
        onPress={handlePress}
        activeOpacity={0.85}
      >
        <AlertTriangle size={36} color={THEME.colors.text.inverse} strokeWidth={2.5} />
        <Text style={styles.buttonText}>{title}</Text>
        <Text style={styles.subText}>{subTitle}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 20,
    height: 220,
  },
  radarWave: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: THEME.colors.emergency.light,
  },
  sosButton: {
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: THEME.colors.emergency.main,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    ...THEME.shadows.emergency,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  buttonText: {
    color: THEME.colors.text.inverse,
    fontSize: THEME.typography.fontSizes.sm + 1,
    fontWeight: '900',
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  subText: {
    color: '#FEE2E2',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
    letterSpacing: 0.2,
  },
});
