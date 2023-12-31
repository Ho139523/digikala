# Generated by Django 4.2.7 on 2023-11-12 21:57

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('shop', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='customer_model',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('first_name', models.CharField(max_length=100, verbose_name='نام')),
                ('last_name', models.CharField(max_length=100, verbose_name='نام خانوادگی')),
                ('phone', models.CharField(max_length=20, verbose_name='شماره همراه')),
                ('emial', models.EmailField(max_length=100, verbose_name='آدرس ایمیل')),
                ('password', models.CharField(max_length=50, verbose_name='رمز عبور')),
                ('credit', models.IntegerField(blank=True, default=0, verbose_name='اعتبار')),
            ],
            options={
                'verbose_name': 'مشتری',
                'verbose_name_plural': 'مشتری\u200cها',
            },
        ),
        migrations.CreateModel(
            name='product_model',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100, verbose_name='نام کالا')),
                ('slug', models.SlugField(max_length=200, verbose_name='آدرس کالا')),
                ('description', models.TextField(max_length=2000000, verbose_name='جزییات')),
                ('price', models.IntegerField(blank=True, default=50000, verbose_name='قیمت محصول')),
                ('picture', models.ImageField(upload_to='product/', verbose_name='تصویر محصول')),
                ('category', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='shop.category_model', verbose_name='دسته\u200cبندی')),
            ],
            options={
                'verbose_name': 'کالا',
                'verbose_name_plural': 'کالاها',
            },
        ),
    ]
