# kotlinx.serialization: generierte Serializer der DTOs behalten.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class io.celox.cue.data.net.** { *** Companion; }
-keepclasseswithmembers class io.celox.cue.data.net.** { kotlinx.serialization.KSerializer serializer(...); }
