# kotlinx.serialization: generierte Serializer der DTOs behalten.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class io.celox.cue.data.net.** { *** Companion; }
-keepclasseswithmembers class io.celox.cue.data.net.** { kotlinx.serialization.KSerializer serializer(...); }

# Tink (unter androidx.security.crypto / EncryptedSharedPreferences) verweist auf
# errorprone-Annotationen, die nur zur Compile-Zeit existieren — zur Laufzeit
# gibt es sie nicht und es braucht sie nicht. Ohne diese Zeile bricht R8 ab.
-dontwarn com.google.errorprone.annotations.**
