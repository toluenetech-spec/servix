package ng.name.servix.app.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp

private val ServixLightColors = lightColorScheme(
    primary = DeepForest,
    onPrimary = WarmIvory,
    primaryContainer = ForestGreen,
    onPrimaryContainer = WarmIvory,
    secondary = ForestGreen,
    onSecondary = WarmIvory,
    tertiary = Coral,
    onTertiary = PureWhite,
    background = WarmIvory,
    onBackground = Charcoal,
    surface = PureWhite,
    onSurface = Charcoal,
    surfaceVariant = SoftSand,
    onSurfaceVariant = MutedGray,
    outline = SoftSand,
    error = Coral,
    onError = PureWhite,
)

// Radii from the web design system: 3 / 6 / 10 px. No gradients anywhere.
private val ServixShapes = Shapes(
    extraSmall = RoundedCornerShape(3.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(10.dp),
    extraLarge = RoundedCornerShape(14.dp),
)

@Composable
fun ServixTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = ServixLightColors, typography = ServixTypography, shapes = ServixShapes, content = content)
}
